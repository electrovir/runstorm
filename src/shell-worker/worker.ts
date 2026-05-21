import {assert} from '@augment-vir/assert';
import {ensureError} from '@augment-vir/common';
import {spawn} from 'node:child_process';
import {parentPort} from 'node:worker_threads';
import {assertValidShape} from 'object-shape-tester';
import {
    FromWorkerMessageType,
    toWorkerMessageShape,
    ToWorkerMessageType,
    type FromWorkerMessage,
    type WorkerCommand,
} from './worker-data.js';

assert.isDefined(parentPort, 'No parent port found. Worker cannot function.');
const assertedPort = parentPort;

function postMessage(message: Readonly<FromWorkerMessage>) {
    assertedPort.postMessage(message);
}

function runCommand(workerCommand: Readonly<WorkerCommand>) {
    return new Promise<void>((resolve) => {
        const childProcess = spawn(workerCommand.command, {
            cwd: workerCommand.cwd || undefined,
            env: {
                ...process.env,
                ...workerCommand.env,
            },
            shell: workerCommand.shell || 'bash',
            /**
             * Place the child in its own process group so the parent can later kill the entire
             * descendant tree (e.g. bash -> npm -> node -> vite) via `process.kill(-pid)`. Without
             * this, grandchildren get orphaned when the worker thread is terminated, because the
             * spawned shell child is parented to the main Node process and survives worker
             * termination.
             */
            detached: true,
        });

        if (childProcess.pid != undefined) {
            postMessage({
                type: FromWorkerMessageType.ChildStarted,
                childPid: childProcess.pid,
            });
        }

        childProcess.stdout.on('data', (chunk: Buffer) => {
            postMessage({
                type: FromWorkerMessageType.Stdout,
                stdout: chunk.toString(),
            });
        });
        childProcess.stderr.on('data', (chunk: Buffer) => {
            postMessage({
                type: FromWorkerMessageType.Stderr,
                stderr: chunk.toString(),
            });
        });
        /* node:coverage ignore next 6: hard to trigger reliably. */
        childProcess.on('error', (error) => {
            postMessage({
                type: FromWorkerMessageType.Error,
                error: ensureError(error),
            });
        });
        childProcess.on('close', (exitCode) => {
            postMessage({
                type: FromWorkerMessageType.Exit,
                exitCode: exitCode || 0,
            });
            resolve();
        });
    });
}

let hasStarted = false;

assertedPort.on('message', async (message) => {
    try {
        assertValidShape(message, toWorkerMessageShape, {allowExtraKeys: true});

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (message.type === ToWorkerMessageType.Start) {
            if (hasStarted) {
                return;
            }
            hasStarted = true;

            postMessage({
                type: FromWorkerMessageType.Starting,
            });

            await runCommand(message.command);
            /* node:coverage ignore next 3: not currently possible to hit this. */
        } else {
            throw new Error(`Unexpected to-worker message type: '${String(message.type)}'`);
        }
    } catch (caught) {
        postMessage({
            type: FromWorkerMessageType.Error,
            error: ensureError(caught),
        });
    }
});
