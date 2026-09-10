import {assertWrap} from '@augment-vir/assert';
import {createInterface} from 'node:readline';
import {type Readable} from 'node:stream';
import {parseJsonWithShape} from 'object-shape-tester';
import {isChildProcessTreeRunning, isProcessRunning, stopChildProcessTree} from './process-tree.js';
import {watchdogMessageShape, WatchdogMessageType, type WatchdogMessage} from './watchdog-data.js';

/**
 * How often the watchdog checks that its parent is still alive and forgets command processes that
 * have already exited. Short enough that an orphaned command tree never lingers noticeably, long
 * enough that an idle watchdog costs nothing.
 */
const parentPollIntervalMs = 1000;

type WatchdogState = {
    childProcessIds: Set<number>;
    hasParentRequestedShutdown: boolean;
};

/**
 * `process.kill` reads a negated `1` as "every process this user owns", so a `1` reaching
 * {@link stopChildProcessTree} would SIGKILL the whole login session. The watchdog's own process and
 * the parent that spawned it are excluded for the same blast-radius reason. This is checked
 * immediately before signaling rather than when an ID arrives, so that no later code path can reach
 * the kill without it.
 *
 * @category Internal
 */
export function isReapableChildProcessId(childProcessId: number) {
    return (
        Number.isSafeInteger(childProcessId) &&
        childProcessId > 1 &&
        childProcessId !== process.pid &&
        childProcessId !== process.ppid
    );
}

const watchdogMessageHandlers: Record<
    WatchdogMessageType,
    (watchdogState: WatchdogState, message: Readonly<WatchdogMessage>) => void
> = {
    [WatchdogMessageType.ChildProcessStarted](watchdogState, message) {
        watchdogState.childProcessIds.add(assertWrap.isNumber(message.childProcessId));
    },
    [WatchdogMessageType.ChildProcessExited](watchdogState, message) {
        watchdogState.childProcessIds.delete(assertWrap.isNumber(message.childProcessId));
    },
    [WatchdogMessageType.Shutdown](watchdogState) {
        watchdogState.hasParentRequestedShutdown = true;
    },
};

function stopChildProcessTrees(watchdogState: Readonly<WatchdogState>) {
    watchdogState.childProcessIds.forEach((childProcessId) => {
        /**
         * A process ID whose tree has already exited may have been recycled as an unrelated process
         * group's leader, and signaling a whole group is not something to do on a guess.
         */
        if (isReapableChildProcessId(childProcessId) && isChildProcessTreeRunning(childProcessId)) {
            stopChildProcessTree(childProcessId, 'SIGKILL');
        }
    });
    watchdogState.childProcessIds.clear();
}

/**
 * Commands that exit without the parent reporting it (any worker terminated before its child's exit
 * message arrived) would otherwise stay registered for the rest of the run, leaving a recycled
 * process ID to be killed later.
 */
function forgetExitedChildProcesses(watchdogState: Readonly<WatchdogState>) {
    watchdogState.childProcessIds.forEach((childProcessId) => {
        if (!isChildProcessTreeRunning(childProcessId)) {
            watchdogState.childProcessIds.delete(childProcessId);
        }
    });
}

/**
 * Starts the detached-process watchdog used by RunStorm's watchdog CLI command. Reads
 * {@link WatchdogMessage}s as JSON lines and kills every still-registered command tree once the
 * parent is gone.
 *
 * @category Internal
 */
export function startChildProcessWatchdog({
    input = process.stdin,
    parentProcessId,
    shutdownGraceMs,
}: Readonly<{
    input?: Readable | undefined;
    parentProcessId: number;
    shutdownGraceMs: number;
}>) {
    const watchdogState: WatchdogState = {
        childProcessIds: new Set(),
        hasParentRequestedShutdown: false,
    };
    const lineReader = createInterface({
        input,
    });

    const parentPollInterval = setInterval(() => {
        if (isProcessRunning(parentProcessId)) {
            forgetExitedChildProcesses(watchdogState);
            return;
        }

        stopChildProcessTrees(watchdogState);
        clearInterval(parentPollInterval);
        lineReader.close();
    }, parentPollIntervalMs);

    lineReader.on('line', (line) => {
        try {
            const message = parseJsonWithShape(line, watchdogMessageShape, {
                allowExtraKeys: true,
            });
            watchdogMessageHandlers[message.type](watchdogState, message);
        } catch {
            /**
             * A malformed line must never disarm the watchdog. Throwing out of this listener would
             * be an uncaught exception that kills the one process responsible for reaping the
             * commands already registered, which is precisely the outcome this whole feature exists
             * to prevent. Standard error is piped nowhere, so the line is simply dropped.
             */
        }
    });

    lineReader.once('close', () => {
        clearInterval(parentPollInterval);

        if (!watchdogState.hasParentRequestedShutdown) {
            /**
             * Standard input closing without a shutdown message means the parent died holding the
             * only write end, so its commands are orphaned as of right now.
             */
            stopChildProcessTrees(watchdogState);
            return;
        }

        /**
         * After a planned exit every worker has already started its own SIGTERM to SIGKILL
         * escalation. Sweeping immediately would preempt that grace period and SIGKILL children
         * that were about to flush and exit cleanly, so wait it out and reap only the survivors.
         */
        setTimeout(() => {
            stopChildProcessTrees(watchdogState);
        }, shutdownGraceMs);
    });
}
