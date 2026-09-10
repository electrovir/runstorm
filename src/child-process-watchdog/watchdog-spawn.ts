import {assertWrap} from '@augment-vir/assert';
import {wrapInTry} from '@augment-vir/common';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {WatchdogMessageType, type WatchdogMessage} from './watchdog-data.js';

/**
 * A handle on the detached child-process watchdog owned by a single RunStorm run.
 *
 * @category Internal
 */
export type ChildProcessWatchdog = {
    childProcessStarted: (childProcessId: number) => void;
    childProcessExited: (childProcessId: number) => void;
    shutdown: () => void;
};

function resolveWatchdogStartupArgs() {
    const isSourceFile = import.meta.filename.endsWith('.ts');

    /* node:coverage ignore next 14: source and compiled modes need different entrypoint loaders. */
    return [
        ...(isSourceFile
            ? [
                  '--no-warnings',
                  '--import',
                  createRequire(import.meta.url).resolve('tsx'),
              ]
            : []),
        resolve(
            import.meta.dirname,
            `../cli/child-process-watchdog.script.${isSourceFile ? 'ts' : 'js'}`,
        ),
    ];
}

/**
 * Spawns the detached watchdog process that reaps a run's command trees if RunStorm itself dies.
 * Returns `undefined` when the watchdog cannot be started, in which case commands still run, just
 * without the guarantee that they die with their parent.
 *
 * @category Internal
 */
export function spawnChildProcessWatchdog({
    shutdownGraceMs,
}: Readonly<{
    shutdownGraceMs: number;
}>): ChildProcessWatchdog | undefined {
    /**
     * `tsx` is only resolvable when this package is loaded from its TypeScript source. A consumer
     * doing that without `tsx` installed should still get working commands.
     */
    const startupArgs = wrapInTry(resolveWatchdogStartupArgs, {
        fallbackValue: undefined,
    });
    /* node:coverage ignore next 3: only reachable when `tsx` cannot be resolved. */
    if (!startupArgs) {
        return undefined;
    }

    const watchdogProcess = spawn(
        process.execPath,
        [
            ...startupArgs,
            `--parent-process-id=${process.pid}`,
            `--shutdown-grace-ms=${shutdownGraceMs}`,
        ],
        {
            detached: true,
            stdio: [
                'pipe',
                'ignore',
                'ignore',
            ],
        },
    );
    /**
     * Never let the watchdog hold RunStorm open, and never let its failures reach RunStorm's
     * uncaught exception handler. A missing watchdog degrades a run; an unhandled `spawn` error
     * (`EAGAIN` under heavy concurrency, for instance) would end it and take every running command
     * along.
     */
    watchdogProcess.unref();
    watchdogProcess.on('error', () => undefined);
    const watchdogInput = assertWrap.isDefined(watchdogProcess.stdin);
    watchdogInput.on('error', () => undefined);

    function writeWatchdogMessage(message: Readonly<WatchdogMessage>) {
        watchdogInput.write(JSON.stringify(message) + '\n');
    }

    return {
        childProcessStarted(childProcessId) {
            writeWatchdogMessage({
                type: WatchdogMessageType.ChildProcessStarted,
                childProcessId,
            });
        },
        childProcessExited(childProcessId) {
            writeWatchdogMessage({
                type: WatchdogMessageType.ChildProcessExited,
                childProcessId,
            });
        },
        shutdown() {
            writeWatchdogMessage({
                type: WatchdogMessageType.Shutdown,
            });
            watchdogInput.end();
        },
    };
}
