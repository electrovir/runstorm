import {assertWrap, waitUntil} from '@augment-vir/assert';
import {
    DeferredPromise,
    ensureArray,
    ensureError,
    ensureErrorAndPrependMessage,
    getObjectTypedEntries,
    log,
    makeWritable,
    selectFrom,
    wait,
    type AnyFunction,
    type MaybeArray,
    type MaybePromise,
    type PartialWithUndefined,
    type Values,
} from '@augment-vir/common';
import {resolve} from 'node:path';
import {Worker} from 'node:worker_threads';
import {assertValidShape} from 'object-shape-tester';
import {defineTypedCustomEvent, ListenTarget} from 'typed-event-target';
import {
    fromWorkerMessageShape,
    FromWorkerMessageType,
    ToWorkerMessageType,
    type ToWorkerMessage,
    type WorkerCommand,
} from './worker-data.js';

/**
 * Emitted from a {@link ShellWorker} when its underlying Worker exits.
 *
 * @category Event
 */
export class WorkerExitEvent extends defineTypedCustomEvent<{exitCode: number}>()('worker-exit') {}
/**
 * Emitted from a {@link ShellWorker} when its underlying Worker produces stderr output.
 *
 * @category Event
 */
export class WorkerStderrEvent extends defineTypedCustomEvent<{stderr: string}>()(
    'worker-stderr',
) {}
/**
 * Emitted from a {@link ShellWorker} when its underlying Worker produces stdout output.
 *
 * @category Event
 */
export class WorkerStdoutEvent extends defineTypedCustomEvent<{stdout: string}>()(
    'worker-stdout',
) {}

/**
 * All {@link ShellWorker} event constructors in an object.
 *
 * @category Internal
 */
export const workerEvents = {
    WorkerExitEvent,
    WorkerStderrEvent,
    WorkerStdoutEvent,
};

/**
 * All {@link ShellWorker} events in a union type.
 *
 * @category Internal
 */
export type WorkerEvent = InstanceType<Values<typeof workerEvents>>;

/**
 * Listeners for {@link ShellWorker}. Used in {@link ShellWorkerOptions}.
 *
 * @category Internal
 */
export type ShellWorkerListeners = PartialWithUndefined<{
    [Key in keyof typeof workerEvents]: MaybeArray<
        (event: InstanceType<(typeof workerEvents)[Key]>) => MaybePromise<void>
    >;
}>;

/**
 * Options for {@link ShellWorker}.
 *
 * @category Internal
 */
export type ShellWorkerOptions = Omit<WorkerCommand, 'command'> &
    PartialWithUndefined<{
        /** Optionally specify your own worker file path. */
        workerFilePath: string;
        /** Attach {@link ShellWorker} listeners immediately. */
        listeners: ShellWorkerListeners;
    }>;

/**
 * An individual shell command spawned in a separate worker thread. Use static methods to create an
 * instance.
 *
 * @category ShellWorker
 */
export class ShellWorker extends ListenTarget<WorkerEvent> {
    /** Creates a worker, executes it, and waits for it to finish. */
    public static async completeWorker(
        command: string,
        options: Readonly<ShellWorkerOptions> = {},
    ) {
        const shellWorker = await ShellWorker.startWorker(command, options);

        return await shellWorker.waitForExit();
    }
    /** Creates a worker and starts it. */
    public static async startWorker(command: string, options: Readonly<ShellWorkerOptions> = {}) {
        const shellWorker = ShellWorker.createWorker(command, options);

        await shellWorker.startExecution();

        return shellWorker;
    }
    /** Creates a worker without executing it. */
    public static createWorker(command: string, options: Readonly<ShellWorkerOptions> = {}) {
        const workerPath = options.workerFilePath || resolve(import.meta.dirname, './worker.js');
        /* node:coverage ignore next 8: all tests run in TS */
        const worker = import.meta.filename.endsWith('.ts')
            ? new Worker(
                  `import('tsx/esm/api').then(({ register }) => { register(); import('${workerPath}') })`,
                  {
                      eval: true,
                  },
              )
            : new Worker(workerPath);

        const workerCommand: WorkerCommand = {
            command,
            ...selectFrom(options, {
                cwd: true,
                env: true,
                shell: true,
            }),
        };

        return new ShellWorker(workerCommand, worker, options);
    }

    /** Indicates that the worker thread has started. */
    public readonly hasStarted: boolean = false;

    /** All stdout combined. This will continue to be updated until the worker thread has exited. */
    public stdout: string[] = [];
    /** All stderr combined. This will continue to be updated until the worker thread has exited. */
    public stderr: string[] = [];
    /** This will only be populated once the worker thread has exited or crashed. */
    public exitCode: number | undefined;
    /** All errors from the worker thread are accumulated here. */
    public errors: Error[] = [];

    protected constructor(
        /** The command that the shell worker thread is to execute. */
        protected readonly workerCommand: Readonly<WorkerCommand>,
        /**
         * The underlying worker thread.
         *
         * @deprecated This should not be used in normal circumstances.
         */
        public readonly worker: Worker,
        /** All options that this instance was created with. */
        protected readonly options: Readonly<ShellWorkerOptions>,
    ) {
        super();
        this.attachExternalListeners(options.listeners);
        this.attachWorkerListeners();
    }

    /** Attaches all listeners passed to this instance via options. */
    protected attachExternalListeners(listeners: Readonly<ShellWorkerListeners> | undefined) {
        if (!listeners) {
            return;
        }

        getObjectTypedEntries(listeners).forEach(
            ([
                key,
                value,
            ]) => {
                const listeners = ensureArray(value || []);

                if (!listeners.length) {
                    return;
                }

                listeners.forEach((listener) => {
                    this.listen(workerEvents[key], listener satisfies AnyFunction as AnyFunction);
                });
            },
        );
    }

    /**
     * Post a message to the worker thread. Typically, you should not need to do this as the worker
     * thread will take care of itself automatically.
     *
     * @deprecated This should not be used in normal circumstances.
     */
    public postMessage(message: Readonly<ToWorkerMessage>) {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.worker.postMessage(message);
    }

    /** Start the worker thread. */
    public async startExecution() {
        if (this.hasStarted) {
            return;
        }

        await waitUntil.isTrue(async () => {
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            this.postMessage({
                type: ToWorkerMessageType.Start,

                command: this.workerCommand,
            });
            await wait({
                milliseconds: 0,
            });
            return this.hasStarted;
        });
    }

    /** Wait for the worker to exit (if it hasn't already exited). */
    public async waitForExit() {
        if (this.exitCode == undefined) {
            const exitDispatched = new DeferredPromise();
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            this.worker.once('exit', () => {
                exitDispatched.resolve();
            });

            await exitDispatched.promise;
        }
        const exitCode = assertWrap.isDefined(this.exitCode);

        return {
            exitCode,
            stderr: this.stderr.join(''),
            stdout: this.stdout.join(''),
            errors: this.errors,
        };
    }

    /**
     * Terminate the worker and destroy this instance. This is the preferred way of forcefully
     * exiting a worker.
     */
    public override async destroy() {
        const exitDispatched = new DeferredPromise();
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.worker.once('exit', () => {
            exitDispatched.resolve();
        });
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        await this.worker.terminate();
        await exitDispatched.promise;
        super.destroy();
    }

    /** Attaches all listeners to the underlying worker thread. */
    protected attachWorkerListeners() {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.worker.addListener('exit', (exitCode) => {
            /** An exit code was already set internally. */
            if (this.exitCode != undefined) {
                return;
            }

            this.dispatch(
                new WorkerExitEvent({
                    detail: {
                        exitCode,
                    },
                }),
            );
        });

        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.worker.addListener('message', async (message) => {
            try {
                assertValidShape(message, fromWorkerMessageShape, {allowExtraKeys: true});

                if (message.type === FromWorkerMessageType.Starting) {
                    makeWritable(this).hasStarted = true;
                } else if (message.type === FromWorkerMessageType.Stdout) {
                    this.stdout.push(message.stdout);
                    this.dispatch(
                        new WorkerStdoutEvent({
                            detail: {
                                stdout: message.stdout,
                            },
                        }),
                    );
                } else if (message.type === FromWorkerMessageType.Stderr) {
                    this.stderr.push(message.stderr);
                    this.dispatch(
                        new WorkerStderrEvent({
                            detail: {
                                stderr: message.stderr,
                            },
                        }),
                    );
                } else if (message.type === FromWorkerMessageType.Exit) {
                    this.exitCode = message.exitCode;
                    this.dispatch(
                        new WorkerExitEvent({
                            detail: {
                                exitCode: message.exitCode,
                            },
                        }),
                    );
                    if (!this.options.keepAlive) {
                        await this.destroy();
                    }
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                } else if (message.type === FromWorkerMessageType.Error) {
                    throw ensureErrorAndPrependMessage(message.error, 'Worker error.');
                    /* node:coverage ignore next 5: not possible to trigger. */
                } else {
                    throw new Error(
                        `Unexpected from-worker message type: '${String(message.type)}'`,
                    );
                }
            } catch (error) {
                this.errors.push(ensureError(error));
                log.error(error);
            }
        });
    }
}
