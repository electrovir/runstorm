import {assertWrap, check, waitUntil} from '@augment-vir/assert';
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
export class WorkerExitEvent extends defineTypedCustomEvent<{
    exitCode: number;
    wasTerminated: boolean;
}>()('worker-exit') {}
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
        /** Directly log all outputs without requiring listeners. */
        hookUpToConsole: boolean;
        /** Attach {@link ShellWorker} listeners immediately. */
        listeners: ShellWorkerListeners;
        /**
         * Override the grace period (in milliseconds) between the initial SIGTERM and the SIGKILL
         * fallback in {@link ShellWorker.destroy}. Long enough by default for well-behaved children
         * (vite, tsx) to shut down cleanly; short enough that an unresponsive tree doesn't keep the
         * user waiting after Ctrl+C. Set to `0` or a negative number to disable the fallback.
         */
        destroyForceKillDelayMs: number;
    }>;

/**
 * Default grace period before `ShellWorker.destroy` escalates from SIGTERM to SIGKILL. See
 * `ShellWorkerOptions.destroyForceKillDelayMs`.
 *
 * @category Internal
 */
export const defaultDestroyForceKillDelayMs = 2000;

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

    /**
     * The PID of the spawned shell child. Defined once the worker has reported it back, undefined
     * before then or on platforms where PIDs are not available.
     */
    public readonly childPid: number | undefined;

    /** All stdout combined. This will continue to be updated until the worker thread has exited. */
    public readonly stdout: string[] = [];
    /** All stderr combined. This will continue to be updated until the worker thread has exited. */
    public readonly stderr: string[] = [];
    /** This will only be populated once the worker thread has exited or crashed. */
    public readonly exitCode: number | undefined;
    /** `true` if this instance has been destroyed. */
    public readonly isDestroyed = false as boolean;
    /** All errors from the worker thread are accumulated here. */
    public readonly errors: Error[] = [];

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
            await waitUntil.isDefined(() => this.exitCode);
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
        if (this.isDestroyed) {
            return;
        }
        makeWritable(this).isDestroyed = true;

        /**
         * Send SIGTERM to the child's entire process group so grandchildren (e.g. vite under npm)
         * die too. Without this, `worker.terminate()` only kills the worker thread, leaving the
         * spawned shell child and its descendants orphaned. Negative-PID process-group signalling
         * is a no-op on Windows; the try/catch absorbs that and the already-exited case.
         *
         * Real-world chains include intermediate processes (npm-workspace shim, tsx --watch,
         * virmator) that either swallow SIGTERM or rely on a parent to forward it — and once
         * `worker.terminate()` runs below, that parent is gone. We schedule a SIGKILL fallback on
         * the same group so any survivor of the SIGTERM round is guaranteed to die. The kill is
         * best-effort: by the time it fires the group may already be empty (clean shutdown happens
         * fast), and `process.kill` will throw, which we absorb.
         */
        if (this.childPid != undefined && this.exitCode == undefined) {
            const pgid = this.childPid;
            try {
                process.kill(-pgid, 'SIGTERM');
                /* node:coverage ignore next 3: cannot test this. */
            } catch {
                // Group is already gone, or we're on a platform that doesn't support it.
            }

            const forceKillDelay =
                this.options.destroyForceKillDelayMs ?? defaultDestroyForceKillDelayMs;
            if (forceKillDelay > 0) {
                const sigkillTimer = setTimeout(() => {
                    try {
                        process.kill(-pgid, 'SIGKILL');
                        /* node:coverage ignore next 3: timer-driven, race-y. */
                    } catch {
                        // Group already exited cleanly, or platform doesn't support it.
                    }
                }, forceKillDelay);
                /**
                 * Don't let the fallback timer keep the host process alive on its own. If
                 * everything shuts down cleanly before the timer fires, the process should be free
                 * to exit; the unref'd timer will simply never fire.
                 */
                sigkillTimer.unref();
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-deprecated
        await this.worker.terminate();
        await this.waitForExit();
        super.destroy();
    }

    /** Attaches all listeners to the underlying worker thread. */
    protected attachWorkerListeners() {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.worker.addListener('message', async (message) => {
            /**
             * Node 24's tsx loader posts internal messages (e.g. `watch:import`) on the same worker
             * port. Anything outside our protocol is ignored so it doesn't trip the shape
             * validator.
             */
            /* node:coverage ignore next 3: only reached on Node 24+ where tsx posts internal messages. */
            if (!check.isEnumValue(message?.type, FromWorkerMessageType)) {
                return;
            }
            try {
                assertValidShape(message, fromWorkerMessageShape, {
                    allowExtraKeys: true,
                });

                if (message.type === FromWorkerMessageType.Starting) {
                    makeWritable(this).hasStarted = true;
                } else if (message.type === FromWorkerMessageType.ChildStarted) {
                    makeWritable(this).childPid = message.childPid;
                } else if (message.type === FromWorkerMessageType.Stdout) {
                    if (this.options.hookUpToConsole) {
                        process.stdout.write(message.stdout);
                    }

                    this.stdout.push(message.stdout);
                    this.dispatch(
                        new WorkerStdoutEvent({
                            detail: {
                                stdout: message.stdout,
                            },
                        }),
                    );
                } else if (message.type === FromWorkerMessageType.Stderr) {
                    if (this.options.hookUpToConsole) {
                        process.stderr.write(message.stderr);
                    }
                    this.stderr.push(message.stderr);
                    this.dispatch(
                        new WorkerStderrEvent({
                            detail: {
                                stderr: message.stderr,
                            },
                        }),
                    );
                } else if (message.type === FromWorkerMessageType.Exit) {
                    /* node:coverage ignore next 3: race condition guard that is unreliable to trigger */
                    if (this.exitCode != undefined) {
                        return;
                    }

                    makeWritable(this).exitCode = assertWrap.isDefined(message.exitCode);

                    this.dispatch(
                        new WorkerExitEvent({
                            detail: {
                                exitCode: message.exitCode,
                                wasTerminated: this.isDestroyed,
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

        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.worker.addListener('exit', (exitCode) => {
            /* node:coverage ignore next 3: race condition guard that is unreliable to trigger */
            if (this.exitCode != undefined) {
                return;
            }
            makeWritable(this).exitCode = exitCode;

            this.dispatch(
                new WorkerExitEvent({
                    detail: {
                        exitCode,
                        wasTerminated: this.isDestroyed,
                    },
                }),
            );
        });
    }
}
