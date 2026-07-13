import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {DeferredPromise, wait} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {resolve} from 'node:path';
import {ShellWorker} from './shell-worker.js';

describe(ShellWorker.name, () => {
    it('completes a worker', async () => {
        assert.deepEquals(await ShellWorker.completeWorker('echo "hi"; echo "hi" >&2;'), {
            exitCode: 0,
            stderr: 'hi\n',
            stdout: 'hi\n',
            errors: [],
        });
    });
    it('hooks up to the console', async () => {
        assert.deepEquals(
            await ShellWorker.completeWorker('echo "hi"; echo "hi" >&2;', {
                hookUpToConsole: true,
            }),
            {
                exitCode: 0,
                stderr: 'hi\n',
                stdout: 'hi\n',
                errors: [],
            },
        );
    });
    it('combines env', async () => {
        process.env.VALUE_1 = 'one';

        assert.deepEquals(
            await ShellWorker.completeWorker('echo $VALUE_1; echo $VALUE_2', {
                env: {
                    VALUE_2: 'two',
                },
            }),
            {
                exitCode: 0,
                stderr: '',
                stdout: 'one\ntwo\n',
                errors: [],
            },
        );
    });
    it('reads stderr', async () => {
        process.env.VALUE_1 = 'one';

        assert.deepEquals(await ShellWorker.completeWorker('echo "ERROR" >&2'), {
            exitCode: 0,
            stderr: 'ERROR\n',
            stdout: '',
            errors: [],
        });
    });
    it('keeps alive', async () => {
        const worker = await ShellWorker.startWorker('echo "test"', {
            keepAlive: true,
        });

        try {
            assert.deepEquals(await worker.waitForExit(), {
                errors: [],
                exitCode: 0,
                stderr: '',
                stdout: 'test\n',
            });

            // eslint-disable-next-line @typescript-eslint/no-deprecated
            worker.postMessage({
                // @ts-expect-error: wrong message type
                type: 'wrong',
            });

            await waitUntil.isLengthExactly(1, () => worker.errors);
        } finally {
            await worker.destroy();
            await worker.destroy();
        }
    });
    it('exits waitForExit when it has already exited', async () => {
        const worker = await ShellWorker.startWorker('echo "test"');

        await worker.waitForExit();
        assert.deepEquals(await worker.waitForExit(), {
            exitCode: 0,
            stderr: '',
            stdout: 'test\n',
            errors: [],
        });
    });
    it('waitForExit waits for exit', async () => {
        const worker = ShellWorker.createWorker('echo "test"');

        const exitPromise = worker.waitForExit();

        await worker.startExecution();
        await worker.startExecution();
        assert.deepEquals(await exitPromise, {
            exitCode: 0,
            stderr: '',
            stdout: 'test\n',
            errors: [],
        });
    });
    it('runs in different directory', async () => {
        const cwd = resolve(process.cwd(), '..');

        assert.deepEquals(await ShellWorker.completeWorker('pwd'), {
            exitCode: 0,
            stderr: '',
            stdout: process.cwd() + '\n',
            errors: [],
        });
        assert.deepEquals(
            await ShellWorker.completeWorker('pwd', {
                cwd,
            }),
            {
                exitCode: 0,
                stderr: '',
                stdout: cwd + '\n',
                errors: [],
            },
        );
    });
    it('starts a worker', async () => {
        const deferredPromise = new DeferredPromise<number>();

        await ShellWorker.startWorker('echo "hi"; echo "hi";', {
            listeners: {
                WorkerExitEvent(event) {
                    deferredPromise.resolve(event.detail.exitCode);
                },
                WorkerStderrEvent: [],
            },
        });

        assert.strictEquals(await deferredPromise.promise, 0);
    });
    it('ignores empty and undefined listeners', async () => {
        assert.strictEquals(
            (
                await ShellWorker.completeWorker('echo "hi"; echo "hi";', {
                    listeners: {
                        WorkerExitEvent: undefined,
                        WorkerStderrEvent: [],
                    },
                })
            ).exitCode,
            0,
        );
    });
    it('can terminate early', async () => {
        const deferredExitCode = new DeferredPromise<number>();

        const worker = await ShellWorker.startWorker('sleep 60000;', {
            listeners: {
                WorkerExitEvent(event) {
                    deferredExitCode.resolve(event.detail.exitCode);
                },
            },
        });

        await worker.destroy();

        assert.notStrictEquals(await deferredExitCode.promise, 0);
    });
    it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
        /**
         * A Node child that traps SIGTERM and prints `ready` once the handler is installed. This is
         * the deterministic way to verify the SIGKILL fallback fires — `bash`'s `trap '' TERM` only
         * protects bash itself, and `sleep` doesn't trap SIGTERM at all, so neither survives the
         * SIGTERM round to exercise the fallback.
         */
        const command = [
            'node -e "',
            "process.on('SIGTERM', () => {});",
            "console.log('ready');",
            'setInterval(() => {}, 1_000);',
            '"',
        ].join(' ');

        const worker = await ShellWorker.startWorker(command, {
            destroyForceKillDelayMs: 100,
        });

        /** Wait for the SIGTERM trap to be installed before we send any signal. */
        await waitUntil.isTrue(() => worker.stdout.some((chunk) => chunk.includes('ready')));
        const childPid = assertWrap.isDefined(worker.childPid);

        await worker.destroy();

        /**
         * `destroy()` returns as soon as the worker thread terminates, but the orphaned shell child
         * may still be in its SIGTERM grace period. Wait past the configured force-kill delay
         * before probing.
         */
        await wait({
            milliseconds: 500,
        });

        /**
         * `process.kill(-pgid, 0)` doesn't deliver a signal — it just probes the process group. If
         * the SIGKILL fallback ran, the group is empty and the call throws ESRCH.
         */
        assert.throws(() => {
            process.kill(-childPid, 0);
        });
    });
});
