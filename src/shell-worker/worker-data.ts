import {
    classShape,
    defineShape,
    exactShape,
    optionalShape,
    recordShape,
    unionShape,
} from 'object-shape-tester';

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
    cwd: optionalShape(unionShape(undefined, '')),
    /**
     * The shell to use when executing the command.
     *
     * @default 'bash'
     */
    shell: optionalShape(unionShape(undefined, '')),
    /** Keep the worker alive even after the shell command has exited. */
    keepAlive: optionalShape(unionShape(undefined, false)),
    /** Extra env values to append to `process.env`. */
    env: optionalShape(
        unionShape(
            undefined,
            recordShape({
                keys: '',
                values: '',
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
    ChildStarted = 'child-started',
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
    unionShape(
        {
            type: exactShape(FromWorkerMessageType.Starting),
        },
        {
            type: exactShape(FromWorkerMessageType.ChildStarted),
            childPid: -1,
        },
        {
            type: exactShape(FromWorkerMessageType.Error),
            error: classShape(Error),
        },
        {
            type: exactShape(FromWorkerMessageType.Exit),
            exitCode: -1,
        },
        {
            type: exactShape(FromWorkerMessageType.Stderr),
            stderr: '',
        },
        {
            type: exactShape(FromWorkerMessageType.Stdout),
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
    unionShape({
        type: exactShape(ToWorkerMessageType.Start),
        command: workerCommandShape,
    }),
);

/**
 * A message sent to the worker.
 *
 * @category Internal
 */
export type ToWorkerMessage = typeof toWorkerMessageShape.runtimeType;
