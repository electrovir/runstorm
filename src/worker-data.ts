import {classShape, defineShape, exact, indexedKeys, optional, or} from 'object-shape-tester';

/**
 * Shape definition for {@link WorkerCommand}.
 *
 * @category Internal
 */
export const workerCommandShape = defineShape({
    /** The command to run. */
    command: '',
    /**
     * The directory to spawn the shell in.
     *
     * @default process.cwd()
     */
    cwd: optional(or(undefined, '')),
    /**
     * The shell to use when executing the command.
     *
     * @default 'bash'
     */
    shell: optional(or(undefined, '')),
    /** Keep the worker alive even after the shell command has exited. */
    keepAlive: optional(or(undefined, false)),
    /** Extra env values to append to `process.env`. */
    env: optional(
        or(
            undefined,
            indexedKeys({
                keys: '',
                values: '',
                required: false,
            }),
        ),
    ),
});

/**
 * The command sent to a worker thread to start it up.
 *
 * @category Internal
 */
export type WorkerCommand = typeof workerCommandShape.runtimeType;

/**
 * Message type for messages coming _from_ the worker thread.
 *
 * @category Internal
 */
export enum FromWorkerMessageType {
    Starting = 'starting',
    Stdout = 'stdout',
    Stderr = 'stderr',
    Exit = 'exit',
    Error = 'error',
}

/**
 * Shape definition for {@link FromWorkerMessage}.
 *
 * @category Internal
 */
export const fromWorkerMessageShape = defineShape(
    or(
        {
            type: exact(FromWorkerMessageType.Starting),
        },
        {
            type: exact(FromWorkerMessageType.Error),
            error: classShape(Error),
        },
        {
            type: exact(FromWorkerMessageType.Exit),
            exitCode: -1,
        },
        {
            type: exact(FromWorkerMessageType.Stderr),
            stderr: '',
        },
        {
            type: exact(FromWorkerMessageType.Stdout),
            stdout: '',
        },
    ),
);

/**
 * A message sent from the worker.
 *
 * @category Internal
 */
export type FromWorkerMessage = typeof fromWorkerMessageShape.runtimeType;

/**
 * Message type for messages going _to_ the worker thread.
 *
 * @category Internal
 */
export enum ToWorkerMessageType {
    Start = 'start',
}

/**
 * Shape definition for {@link ToWorkerMessage}.
 *
 * @category Internal
 */
export const toWorkerMessageShape = defineShape(
    or({
        type: exact(ToWorkerMessageType.Start),
        command: workerCommandShape,
    }),
);

/**
 * A message sent to the worker.
 *
 * @category Internal
 */
export type ToWorkerMessage = typeof toWorkerMessageShape.runtimeType;
