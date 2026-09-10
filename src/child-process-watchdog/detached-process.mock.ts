import {assertWrap, waitUntil} from '@augment-vir/assert';
import {spawn} from 'node:child_process';

/**
 * Spawns a detached process that traps SIGTERM and never exits on its own. A test that watches it
 * disappear has therefore proven that something SIGKILLed it, rather than that it happened to
 * finish.
 */
export function spawnStubbornProcessId() {
    const childProcess = spawn(
        process.execPath,
        [
            '-e',
            "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000);",
        ],
        {
            detached: true,
            stdio: 'ignore',
        },
    );
    childProcess.unref();

    return assertWrap.isNumber(childProcess.pid);
}

/** Spawns a detached process, waits for it to exit, and returns its now-dead process ID. */
export async function spawnExitedProcessId() {
    const childProcess = spawn(
        process.execPath,
        [
            '-e',
            '',
        ],
        {
            detached: true,
            stdio: 'ignore',
        },
    );
    const childProcessId = assertWrap.isNumber(childProcess.pid);

    await waitUntil.isDefined(() => childProcess.exitCode, {
        interval: {
            milliseconds: 50,
        },
        timeout: {
            seconds: 5,
        },
    });

    return childProcessId;
}
