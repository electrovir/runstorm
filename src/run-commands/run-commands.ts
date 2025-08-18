import {check} from '@augment-vir/assert';
import {
    DeferredPromise,
    LogOutputType,
    mapEnumToObject,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {type SetOptional} from 'type-fest';
import {ShellWorker} from '../shell-worker/shell-worker.js';
import {type ColorKey} from './color-key.js';
import {
    createSummary,
    handleCommandLog,
    type CommandLoggers,
    type Exits,
} from './command-logging.js';
import {createCommands, sanitizeCommands, type Command} from './command.js';

/**
 * Options for the --kill-on flag.
 *
 * @category Internal
 */
export enum KillOn {
    /** Kill all commands when any of them succeed. */
    Success = 'success',
    /** Kill all commands when any of them fail. */
    Failure = 'failure',
    /** Kill all commands when any of them exit (with either a success or a failure). */
    Exit = 'exit',
}

/**
 * All supported command options for RunStorm.
 *
 * @category Internal
 */
export type RunCommandOptions = PartialWithUndefined<{
    /**
     * The maximum number of threads that can run at the same time.
     *
     * @default Infinity
     */
    maxConcurrency: number;
    killOn: KillOn;
    disableSummary: boolean;
    cwd: string;
    env: Record<string, string>;
    disableColorPreserve: boolean;
    shell: string;
    workerFilePath: string;
    /** Optional custom loggers. Defaults to `process.stdout.write` and `process.stderr.write`. */
    loggers: PartialWithUndefined<Readonly<CommandLoggers>>;
}>;

/**
 * Run all given raw command strings within RunStorm.
 *
 * @category Main
 * @returns The exits codes of each command in order.
 */
export async function runRawCommands(
    commands: ReadonlyArray<string>,
    commandNames: ReadonlyArray<string> = [],
    commandColors: ReadonlyArray<ColorKey> = [],
    options: Readonly<RunCommandOptions> = {},
) {
    return await runCommands(createCommands(commands, commandNames, commandColors), options);
}

/**
 * Run all given raw commands within RunStorm.
 *
 * @category Main
 * @returns The exits codes of each command in order.
 */
export async function runCommands(
    commandInputs: ReadonlyArray<Readonly<SetOptional<Command, 'color' | 'name'>>>,
    options: Readonly<RunCommandOptions> = {},
): Promise<{exitCodes: Exits; highestExitCode: number}> {
    const commands = sanitizeCommands(commandInputs);

    const maxConcurrency: number = Math.abs(options.maxConcurrency || 0) || Infinity;
    const exitCodes: Exits = [];
    let highestExitCode: number = 0;
    let areAllTerminated = false;
    const loggers = mapEnumToObject(LogOutputType, (outputType) => {
        return (
            options.loggers?.[outputType] ||
            ((output: string) => process[outputType].write(output + '\n'))
        );
    });

    const commandsLeft = commands.map((command, commandIndex) => {
        return {
            command,
            commandIndex,
        };
    });
    const currentRunningWorkers = new Set<ShellWorker>();

    const allWorkersDone = new DeferredPromise();

    function addWorker() {
        if (
            areAllTerminated ||
            currentRunningWorkers.size >= maxConcurrency ||
            allWorkersDone.isSettled
        ) {
            return;
        }

        const commandWrapper = commandsLeft.shift();

        if (!commandWrapper) {
            return;
        }
        const {command, commandIndex} = commandWrapper;

        /** Keep track of colors across logs so they remain consistent. */
        const lastColors: Record<LogOutputType, string[]> = {
            [LogOutputType.Error]: [],
            [LogOutputType.Standard]: [],
        };

        const worker = ShellWorker.createWorker(command.command, {
            cwd: command.cwd || options.cwd,
            env: options.env,
            shell: options.shell,
            workerFilePath: options.workerFilePath,
            listeners: {
                WorkerExitEvent({detail: {exitCode, wasTerminated}}) {
                    currentRunningWorkers.delete(worker);

                    const logString = [
                        `exited with exit code ${exitCode}`,
                        wasTerminated ? ' (cancelled)' : '',
                        '.',
                    ]
                        .filter(check.isTruthy)
                        .join('');

                    handleCommandLog({
                        command,
                        lastColors,
                        loggers,
                        options,
                        output: logString,
                        outputType:
                            wasTerminated || exitCode
                                ? LogOutputType.Error
                                : LogOutputType.Standard,
                    });

                    if (wasTerminated) {
                        areAllTerminated = true;
                    }

                    exitCodes[commandIndex] = wasTerminated ? 'cancelled' : exitCode;

                    if (!wasTerminated && exitCode > highestExitCode) {
                        highestExitCode = exitCode;
                    }

                    if (
                        (options.killOn === KillOn.Success && !exitCode) ||
                        (options.killOn === KillOn.Failure && exitCode) ||
                        options.killOn === KillOn.Exit
                    ) {
                        areAllTerminated = true;
                        currentRunningWorkers.forEach((shellWorker) => shellWorker.destroy());
                    }

                    if ((areAllTerminated || !commandsLeft.length) && !currentRunningWorkers.size) {
                        allWorkersDone.resolve();
                    } else {
                        addWorker();
                    }
                },
                WorkerStderrEvent(event) {
                    handleCommandLog({
                        command,
                        lastColors,
                        loggers,
                        options,
                        output: event.detail.stderr,
                        outputType: LogOutputType.Error,
                    });
                },
                WorkerStdoutEvent(event) {
                    handleCommandLog({
                        command,
                        lastColors,
                        loggers,
                        options,
                        output: event.detail.stdout,
                        outputType: LogOutputType.Standard,
                    });
                },
            },
        });
        currentRunningWorkers.add(worker);

        void worker.startExecution();

        addWorker();
    }

    addWorker();

    await allWorkersDone.promise;

    if (!options.disableSummary) {
        loggers.stdout('\n\n' + createSummary(commands, exitCodes) + '\n\n');
    }

    return {
        exitCodes,
        highestExitCode,
    };
}
