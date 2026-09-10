import {assert, check} from '@augment-vir/assert';
import {ensureError} from '@augment-vir/common';
import {spawn} from 'node:child_process';
import {constants} from 'node:os';
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

        /* node:coverage ignore next 6: Node provides a PID for spawned child processes. */
        if (childProcess.pid != undefined) {
            postMessage({
                type: FromWorkerMessageType.ChildStarted,
                childPid: childProcess.pid,
            });
        }

        /* node:coverage ignore next 12: worker-thread output is covered by ShellWorker integration tests. */
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
        childProcess.on('close', (exitCode, signal) => {
            postMessage({
                type: FromWorkerMessageType.Exit,
                /**
                 * A signal-killed child reports a `null` exit code. Use the shell's `128 + signal`
                 * convention so that a command killed by SIGTERM or SIGKILL is not reported as
                 * having succeeded. Node always reports exactly one of the two, so the final `0` is
                 * unreachable and exists only because both parameters are nullable in the types.
                 */
                /* node:coverage ignore next 1: Node never reports a null exit code without a signal. */
                exitCode: exitCode ?? (signal ? 128 + constants.signals[signal] : 0),
            });
            resolve();
        });
    });
}

let hasStarted = false;

assertedPort.on('message', async (message) => {
    /**
     * Node 24's tsx loader posts internal messages (e.g. `watch:import`) on the same parent port;
     * they have no `type` field. Skip those so they don't trip the shape validator. Messages with a
     * `type` field but wrong value still fall through to be reported as protocol errors.
     */
    /* node:coverage ignore next 3: only reached on Node 24+ where tsx posts internal messages. */
    if (!check.isObject(message) || !('type' in message)) {
        return;
    }
    try {
        assertValidShape(message, toWorkerMessageShape, {
            allowExtraKeys: true,
        });

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
        /* node:coverage ignore next 6: worker-thread errors are covered by ShellWorker integration tests. */
    } catch (caught) {
        postMessage({
            type: FromWorkerMessageType.Error,
            error: ensureError(caught),
        });
    }
});
