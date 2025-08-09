import {assert, waitUntil} from '@augment-vir/assert';
import {DeferredPromise} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {resolve} from 'node:path';
import {ShellWorker} from './shell-worker.js';

describe(ShellWorker.name, () => {
    it('completes a worker', async () => {
        assert.deepEquals(await ShellWorker.completeWorker('echo "hi"; echo "hi";'), {
            exitCode: 0,
            stderr: '',
            stdout: 'hi\nhi\n',
            errors: [],
        });
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
        }
    });
    it('exits waitForExit when it has already exited', async () => {
        const worker = await ShellWorker.startWorker('echo "test"');

        await worker.waitForExit();
        await worker.waitForExit();
    });
    it('waitForExit waits for exit', async () => {
        const worker = ShellWorker.createWorker('echo "test"');

        const exitPromise = worker.waitForExit();

        await worker.startExecution();
        await worker.startExecution();
        await exitPromise;
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
});
