import {assert} from '@augment-vir/assert';
import {ensureError} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
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

async function runCommand(workerCommand: Readonly<WorkerCommand>) {
    const result = await runShellCommand(workerCommand.command, {
        cwd: workerCommand.cwd || undefined,
        env: {
            ...process.env,
            ...workerCommand.env,
        },
        shell: workerCommand.shell || undefined,
        stderrCallback(stderr) {
            postMessage({
                type: FromWorkerMessageType.Stderr,
                stderr,
            });
        },
        stdoutCallback(stdout) {
            postMessage({
                type: FromWorkerMessageType.Stdout,
                stdout,
            });
        },
    });

    postMessage({
        type: FromWorkerMessageType.Exit,
        exitCode: result.exitCode || 0,
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
