import {assert, waitUntil} from '@augment-vir/assert';
import {wait} from '@augment-vir/common';
import {describe, it, itCases} from '@augment-vir/test';
import {PassThrough} from 'node:stream';
import {spawnExitedProcessId, spawnStubbornProcessId} from './detached-process.mock.js';
import {isChildProcessTreeRunning, stopChildProcessTree} from './process-tree.js';
import {WatchdogMessageType, type WatchdogMessage} from './watchdog-data.js';
import {isReapableChildProcessId, startChildProcessWatchdog} from './watchdog.js';

function writeWatchdogMessages(input: PassThrough, messages: ReadonlyArray<string>) {
    input.write(messages.join('\n') + '\n');
}

function watchdogMessage(message: Readonly<WatchdogMessage>) {
    return JSON.stringify(message);
}

function trackChildProcess(childProcessId: number) {
    return watchdogMessage({
        type: WatchdogMessageType.ChildProcessStarted,
        childProcessId,
    });
}

async function waitForProcessTreeToStop(childProcessId: number) {
    await waitUntil.isFalse(() => isChildProcessTreeRunning(childProcessId), {
        interval: {
            milliseconds: 50,
        },
        timeout: {
            seconds: 5,
        },
    });
}

describe(isReapableChildProcessId.name, () => {
    itCases(isReapableChildProcessId, [
        {
            it: 'rejects the whole-session broadcast target',
            /** A negated `1` tells `process.kill` to signal every process the user owns. */
            input: 1,
            expect: false,
        },
        {
            it: 'rejects the current process group',
            input: 0,
            expect: false,
        },
        {
            it: 'rejects an already negative ID',
            input: -1,
            expect: false,
        },
        {
            it: 'rejects the watchdog itself',
            input: process.pid,
            expect: false,
        },
        {
            it: 'rejects the parent that spawned the watchdog',
            input: process.ppid,
            expect: false,
        },
        {
            it: 'rejects a non-integer',
            input: 1.5,
            expect: false,
        },
        {
            it: 'accepts an ordinary process ID',
            input: 999_999_999,
            expect: true,
        },
    ]);
});

describe(startChildProcessWatchdog.name, () => {
    it('kills tracked command trees once its parent is gone', async () => {
        const stubbornProcessId = spawnStubbornProcessId();
        const input = new PassThrough();

        try {
            startChildProcessWatchdog({
                input,
                parentProcessId: await spawnExitedProcessId(),
                shutdownGraceMs: 0,
            });
            writeWatchdogMessages(input, [trackChildProcess(stubbornProcessId)]);

            await waitForProcessTreeToStop(stubbornProcessId);
        } finally {
            stopChildProcessTree(stubbornProcessId, 'SIGKILL');
            input.end();
        }
    });
    it('keeps guarding after a malformed message', async () => {
        const stubbornProcessId = spawnStubbornProcessId();
        const input = new PassThrough();

        try {
            startChildProcessWatchdog({
                input,
                parentProcessId: await spawnExitedProcessId(),
                shutdownGraceMs: 0,
            });
            /**
             * A throw out of the line listener would be an uncaught exception in the one process
             * responsible for reaping these commands. Tracking a command _after_ the bad lines is
             * what proves the watchdog is still reading its input at all.
             */
            writeWatchdogMessages(input, [
                'not json at all',
                '{"type":"no-such-message-type"}',
                '{"type":"child-process-started"}',
                trackChildProcess(stubbornProcessId),
            ]);

            await waitForProcessTreeToStop(stubbornProcessId);
        } finally {
            stopChildProcessTree(stubbornProcessId, 'SIGKILL');
            input.end();
        }
    });
    it('kills tracked command trees when standard input closes unexpectedly', async () => {
        const stubbornProcessId = spawnStubbornProcessId();
        const input = new PassThrough();

        try {
            startChildProcessWatchdog({
                input,
                parentProcessId: process.pid,
                shutdownGraceMs: 0,
            });
            writeWatchdogMessages(input, [
                trackChildProcess(stubbornProcessId),
                trackChildProcess(await spawnExitedProcessId()),
            ]);
            /** No shutdown message means the parent died holding the only write end. */
            input.end();

            await waitForProcessTreeToStop(stubbornProcessId);
        } finally {
            stopChildProcessTree(stubbornProcessId, 'SIGKILL');
        }
    });
    it('waits out the grace period on a planned shutdown', async () => {
        const stubbornProcessId = spawnStubbornProcessId();
        const input = new PassThrough();

        try {
            startChildProcessWatchdog({
                input,
                parentProcessId: process.pid,
                shutdownGraceMs: 500,
            });
            writeWatchdogMessages(input, [
                trackChildProcess(stubbornProcessId),
                watchdogMessage({
                    type: WatchdogMessageType.Shutdown,
                }),
            ]);
            input.end();

            /**
             * Sweeping immediately here is the bug this covers: the workers have already sent their
             * own SIGTERM and are waiting out the same grace period, so an early SIGKILL robs every
             * command of its chance to shut down cleanly.
             */
            await wait({
                milliseconds: 150,
            });
            assert.isTrue(isChildProcessTreeRunning(stubbornProcessId));

            await waitForProcessTreeToStop(stubbornProcessId);
        } finally {
            stopChildProcessTree(stubbornProcessId, 'SIGKILL');
        }
    });
    it('leaves tracked commands alone while its parent lives', async () => {
        const stubbornProcessId = spawnStubbornProcessId();
        const input = new PassThrough();

        try {
            startChildProcessWatchdog({
                input,
                parentProcessId: process.pid,
                shutdownGraceMs: 0,
            });
            writeWatchdogMessages(input, [
                trackChildProcess(stubbornProcessId),
                trackChildProcess(await spawnExitedProcessId()),
                watchdogMessage({
                    type: WatchdogMessageType.ChildProcessExited,
                    childProcessId: await spawnExitedProcessId(),
                }),
            ]);

            /** Long enough for at least one full poll of the parent to have run. */
            await wait({
                milliseconds: 1500,
            });
            assert.isTrue(isChildProcessTreeRunning(stubbornProcessId));
        } finally {
            stopChildProcessTree(stubbornProcessId, 'SIGKILL');
            input.end();
        }
    });
});
