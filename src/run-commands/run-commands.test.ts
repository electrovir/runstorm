import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {
    DeferredPromise,
    LogOutputType,
    mapEnumToObject,
    removeColor,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {describe, it, itCases} from '@augment-vir/test';
import {existsSync} from 'node:fs';
import {readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {repoDirPath, srcDirPath} from '../repo-paths.mock.js';
import {ColorKey} from './color-key.js';
import {type Command} from './command.js';
import {
    KillOn,
    runCommandMatrix,
    runCommands,
    runRawCommands,
    type RunCommandOptions,
} from './run-commands.js';

describe(runRawCommands.name, () => {
    async function testRawCommands(
        commands: ReadonlyArray<string>,
        options: Readonly<
            RunCommandOptions &
                PartialWithUndefined<{
                    keepColor: boolean;
                }>
        > = {},
    ) {
        const logs = mapEnumToObject(LogOutputType, () => [] as string[]);

        await runRawCommands({
            commands,
            options: {
                loggers: mapEnumToObject(LogOutputType, (outputType) => {
                    return (output: string) => {
                        return logs[outputType].push(
                            (options.keepColor ? output : removeColor(output)).trim(),
                        );
                    };
                }),
                ...options,
            },
        });

        return logs;
    }

    itCases(testRawCommands, [
        {
            it: 'completes',
            inputs: [
                [
                    'sleep 1; echo "one";',
                    'echo "two"',
                ],
            ],
            expect: {
                stderr: [],
                stdout: [
                    '[echo] two',
                    '[echo] exited with exit code 0.',
                    '[sleep] one',
                    '[sleep] exited with exit code 0.',
                    'RunStorm Summary:\n [echo] succeeded.\n[sleep] succeeded.',
                ],
            },
        },
        {
            it: 'logs stderr',
            inputs: [
                [
                    'echo "one" >&2',
                ],
            ],
            expect: {
                stderr: [
                    '[echo] one',
                ],
                stdout: [
                    '[echo] exited with exit code 0.',
                    'RunStorm Summary:\n[echo] succeeded.',
                ],
            },
        },
        {
            it: 'terminates on failure',
            inputs: [
                [
                    'sleep 10; echo "one";',
                    'echo "two"; exit 1;',
                ],
                {
                    killOn: KillOn.Failure,
                },
            ],
            expect: {
                stderr: [
                    '[echo] exited with exit code 1.',
                    '[sleep] exited with exit code 1 (cancelled).',
                ],
                stdout: [
                    '[echo] two',
                    'RunStorm Summary:\n [echo] failed.\n[sleep] cancelled.',
                ],
            },
        },
        {
            it: 'terminates on success',
            inputs: [
                [
                    'sleep 10; echo "one";',
                    'echo "two";',
                ],
                {
                    killOn: KillOn.Success,
                },
            ],
            expect: {
                stderr: [
                    '[sleep] exited with exit code 1 (cancelled).',
                ],
                stdout: [
                    '[echo] two',
                    '[echo] exited with exit code 0.',
                    'RunStorm Summary:\n [echo] succeeded.\n[sleep] cancelled.',
                ],
            },
        },
        {
            it: 'cancels concurrent threads',
            inputs: [
                [
                    'sleep 5; echo "one";',
                    'sleep 2; echo "two";',
                    'sleep 1; echo "three";',
                    'sleep 1; echo "four";',
                ],
                {
                    killOn: KillOn.Success,
                    maxConcurrency: 2,
                },
            ],
            expect: {
                stderr: [
                    '[sleep] exited with exit code 1 (cancelled).',
                ],
                stdout: [
                    '[sleep 2] two',
                    '[sleep 2] exited with exit code 0.',
                    'RunStorm Summary:\n  [sleep] cancelled.\n[sleep 2] succeeded.\n[sleep 3] cancelled.\n[sleep 4] cancelled.',
                ],
            },
        },
        {
            it: 'preserves color lines',
            inputs: [
                [
                    "echo $'\x1b[34m one'; sleep 1; echo $' two\x1b[0m'; sleep 1; echo 'three'",
                ],
                {
                    keepColor: true,
                },
            ],
            expect: {
                stderr: [],
                stdout: [
                    '\x1b[31m[echo]\x1b[39m \x1b[34m one\x1b[0m',
                    '\x1b[31m[echo]\x1b[39m \x1b[34m two\x1b[0m\x1b[0m',
                    '\x1b[31m[echo]\x1b[39m three\x1b[0m',
                    '\x1b[31m[echo]\x1b[39m exited with exit code 0.\x1b[0m',
                    // cspell:word msucceeded
                    '\x1b[1mRunStorm Summary:\x1b[0m\n\x1b[31m[echo]\x1b[39m \x1b[32m\x1b[1msucceeded.\x1b[0m',
                ],
            },
        },
        {
            it: 'limits concurrent threads',
            inputs: [
                [
                    'sleep 10; echo "one";',
                    'sleep 1; echo "two";',
                    'sleep 1; echo "three";',
                    'sleep 1; echo "four";',
                ],
                {
                    maxConcurrency: 2,
                },
            ],
            expect: {
                stderr: [],
                stdout: [
                    '[sleep 2] two',
                    '[sleep 2] exited with exit code 0.',
                    '[sleep 3] three',
                    '[sleep 3] exited with exit code 0.',
                    '[sleep 4] four',
                    '[sleep 4] exited with exit code 0.',
                    '[sleep] one',
                    '[sleep] exited with exit code 0.',
                    'RunStorm Summary:\n  [sleep] succeeded.\n[sleep 2] succeeded.\n[sleep 3] succeeded.\n[sleep 4] succeeded.',
                ],
            },
        },
    ]);

    it('runs with default loggers', async () => {
        const {highestExitCode} = await runRawCommands({
            commands: ['echo "hi"'],
        });

        assert.strictEquals(highestExitCode, 0);
    });
});

describe(runCommandMatrix.name, () => {
    async function testCommandMatrix(
        commands: ReadonlyArray<ReadonlyArray<Readonly<Command>>>,
        options: Readonly<
            RunCommandOptions &
                PartialWithUndefined<{
                    keepColor: boolean;
                }>
        > = {},
    ) {
        const logs = mapEnumToObject(LogOutputType, () => [] as string[]);

        await runCommandMatrix(commands, {
            loggers: mapEnumToObject(LogOutputType, (outputType) => {
                return (output: string) => {
                    return logs[outputType].push(
                        (options.keepColor ? output : removeColor(output)).trim(),
                    );
                };
            }),
            ...options,
        });

        return logs;
    }

    it('runs with the default logger', async () => {
        assert.deepEquals(
            await runCommandMatrix([
                [
                    {
                        command: 'pwd',
                        color: ColorKey.blue,
                        name: 'first',
                        cwd: repoDirPath,
                    },
                    {
                        command: 'sleep 2 && pwd',
                        color: ColorKey.red,
                        name: 'second',
                        cwd: srcDirPath,
                    },
                ],
            ]),
            {
                exitCodes: [
                    [
                        0,
                        0,
                    ],
                ],
                highestExitCode: 0,
                terminated: false,
            },
        );
    });

    itCases(testCommandMatrix, [
        {
            it: 'runs a single matrix row',
            inputs: [
                [
                    [
                        {
                            command: 'pwd',
                            color: ColorKey.blue,
                            name: 'first',
                            cwd: repoDirPath,
                        },
                        {
                            command: 'sleep 2 && pwd',
                            color: ColorKey.red,
                            name: 'second',
                            cwd: srcDirPath,
                        },
                    ],
                ],
            ],
            expect: {
                stderr: [],
                stdout: [
                    `[first] ${repoDirPath}`,
                    '[first] exited with exit code 0.',
                    `[second] ${srcDirPath}`,
                    '[second] exited with exit code 0.',
                    'RunStorm Summary:\n [first] succeeded.\n[second] succeeded.',
                ],
            },
        },
        {
            it: 'runs multiple rows to success',
            inputs: [
                [
                    [
                        {
                            command: 'sleep 1; echo "one-a"',
                            name: 'row1a',
                            color: ColorKey.blue,
                        },
                        {
                            command: 'sleep 2; echo "one-b"',
                            name: 'row1b',
                            color: ColorKey.red,
                        },
                    ],
                    [
                        {
                            command: 'sleep 1; echo "two-a"',
                            name: 'row2a',
                            color: ColorKey.green,
                        },
                        {
                            command: 'sleep 2; echo "two-b"',
                            name: 'row2b',
                            color: ColorKey.yellow,
                        },
                    ],
                    [
                        {
                            command: 'sleep 1; echo "three-a"',
                            name: 'row3a',
                            color: ColorKey.cyan,
                        },
                        {
                            command: 'sleep 2; echo "three-b"',
                            name: 'row3b',
                            color: ColorKey.magenta,
                        },
                    ],
                ],
            ],
            expect: {
                stderr: [],
                stdout: [
                    '[row1a] one-a',
                    '[row1a] exited with exit code 0.',
                    '[row1b] one-b',
                    '[row1b] exited with exit code 0.',
                    '[row2a] two-a',
                    '[row2a] exited with exit code 0.',
                    '[row2b] two-b',
                    '[row2b] exited with exit code 0.',
                    '[row3a] three-a',
                    '[row3a] exited with exit code 0.',
                    '[row3b] three-b',
                    '[row3b] exited with exit code 0.',
                    'RunStorm Summary:\n[row1a] succeeded.\n[row1b] succeeded.\n[row2a] succeeded.\n[row2b] succeeded.\n[row3a] succeeded.\n[row3b] succeeded.',
                ],
            },
        },
        {
            it: 'fails on a middle row and cancels following rows',
            inputs: [
                [
                    [
                        {
                            command: 'sleep 1; echo "first-a"',
                            name: 'row1a',
                            color: ColorKey.blue,
                        },
                        {
                            command: 'sleep 2; echo "first-b"',
                            name: 'row1b',
                            color: ColorKey.red,
                        },
                    ],
                    [
                        {
                            command: 'echo "middle-a"; exit 1;',
                            name: 'row2a',
                            color: ColorKey.green,
                        },
                        {
                            command: 'sleep 5; echo "middle-b"',
                            name: 'row2b',
                            color: ColorKey.yellow,
                        },
                    ],
                    [
                        {
                            command: 'echo "last-a"',
                            name: 'row3a',
                            color: ColorKey.cyan,
                        },
                        {
                            command: 'echo "last-b"',
                            name: 'row3b',
                            color: ColorKey.magenta,
                        },
                    ],
                ],
                {
                    killOn: KillOn.Failure,
                },
            ],
            expect: {
                stderr: [
                    '[row2a] exited with exit code 1.',
                    '[row2b] exited with exit code 1 (cancelled).',
                ],
                stdout: [
                    '[row1a] first-a',
                    '[row1a] exited with exit code 0.',
                    '[row1b] first-b',
                    '[row1b] exited with exit code 0.',
                    '[row2a] middle-a',
                    'RunStorm Summary:\n[row1a] succeeded.\n[row1b] succeeded.\n[row2a] failed.\n[row2b] cancelled.\n[row3a] cancelled.\n[row3b] cancelled.',
                ],
            },
        },
        {
            it: 'fails on the first row',
            inputs: [
                [
                    [
                        {
                            command: 'echo "first-a"; exit 1;',
                            name: 'row1a',
                            color: ColorKey.blue,
                        },
                        {
                            command: 'sleep 5; echo "first-b"',
                            name: 'row1b',
                            color: ColorKey.red,
                        },
                    ],
                    [
                        {
                            command: 'echo "second-a"',
                            name: 'row2a',
                            color: ColorKey.green,
                        },
                        {
                            command: 'echo "second-b"',
                            name: 'row2b',
                            color: ColorKey.yellow,
                        },
                    ],
                ],
                {
                    killOn: KillOn.Failure,
                },
            ],
            expect: {
                stderr: [
                    '[row1a] exited with exit code 1.',
                    '[row1b] exited with exit code 1 (cancelled).',
                ],
                stdout: [
                    '[row1a] first-a',
                    'RunStorm Summary:\n[row1a] failed.\n[row1b] cancelled.\n[row2a] cancelled.\n[row2b] cancelled.',
                ],
            },
        },
        {
            it: 'fails on the last row',
            inputs: [
                [
                    [
                        {
                            command: 'sleep 1; echo "first-a"',
                            name: 'row1a',
                            color: ColorKey.blue,
                        },
                        {
                            command: 'sleep 2; echo "first-b"',
                            name: 'row1b',
                            color: ColorKey.red,
                        },
                    ],
                    [
                        {
                            command: 'echo "second-a"; exit 1;',
                            name: 'row2a',
                            color: ColorKey.green,
                        },
                        {
                            command: 'sleep 5; echo "second-b"',
                            name: 'row2b',
                            color: ColorKey.yellow,
                        },
                    ],
                ],
                {
                    killOn: KillOn.Failure,
                },
            ],
            expect: {
                stderr: [
                    '[row2a] exited with exit code 1.',
                    '[row2b] exited with exit code 1 (cancelled).',
                ],
                stdout: [
                    '[row1a] first-a',
                    '[row1a] exited with exit code 0.',
                    '[row1b] first-b',
                    '[row1b] exited with exit code 0.',
                    '[row2a] second-a',
                    'RunStorm Summary:\n[row1a] succeeded.\n[row1b] succeeded.\n[row2a] failed.\n[row2b] cancelled.',
                ],
            },
        },
    ]);
});

describe(runCommands.name, () => {
    it('does not require a package executable on PATH', async () => {
        const compiledFilePath = resolve(
            import.meta.dirname,
            '../../dist/run-commands/run-commands.js',
        );
        /**
         * Only the compiled build can prove this: from `dist` the watchdog is spawned as plain
         * JavaScript with no `tsx` loader to resolve out of `node_modules/.bin`. A checkout that
         * has not been compiled yet has nothing to assert against.
         */
        if (!existsSync(compiledFilePath)) {
            return;
        }

        const pathVariableName = process.platform === 'win32' ? 'Path' : 'PATH';
        const originalPath = assertWrap.isDefined(process.env[pathVariableName]);
        process.env[pathVariableName] = '/no-package-executables';

        try {
            /**
             * A computed import specifier resolves to `any`, so the annotation is what keeps this
             * call site type checked against the source definition.
             */
            const {runCommands: runCompiledCommands}: {runCommands: typeof runCommands} =
                await import(pathToFileURL(compiledFilePath).href);
            const result = await runCompiledCommands(
                [
                    {
                        command: process.platform === 'win32' ? 'echo ready' : 'printf ready',
                    },
                ],
                {
                    disableSummary: true,
                    loggers: {
                        stderr: () => undefined,
                        stdout: () => undefined,
                    },
                    shell:
                        process.platform === 'win32'
                            ? assertWrap.isDefined(process.env.ComSpec)
                            : '/bin/bash',
                },
            );

            assert.strictEquals(result.highestExitCode, 0);
        } finally {
            process.env[pathVariableName] = originalPath;
        }
    });

    async function testCommands(
        commands: ReadonlyArray<Readonly<Command>>,
        options: Readonly<
            RunCommandOptions &
                PartialWithUndefined<{
                    keepColor: boolean;
                }>
        > = {},
    ) {
        const logs = mapEnumToObject(LogOutputType, () => [] as string[]);

        await runCommands(commands, {
            loggers: mapEnumToObject(LogOutputType, (outputType) => {
                return (output: string) => {
                    return logs[outputType].push(
                        (options.keepColor ? output : removeColor(output)).trim(),
                    );
                };
            }),
            ...options,
        });

        return logs;
    }

    itCases(testCommands, [
        {
            it: 'uses individual command CWD',
            inputs: [
                [
                    {
                        command: 'pwd',
                        color: ColorKey.blue,
                        name: 'first',
                        cwd: repoDirPath,
                    },
                    {
                        command: 'sleep 2 && pwd',
                        color: ColorKey.red,
                        name: 'second',
                        cwd: srcDirPath,
                    },
                ],
            ],
            expect: {
                stderr: [],
                stdout: [
                    `[first] ${repoDirPath}`,
                    '[first] exited with exit code 0.',
                    `[second] ${srcDirPath}`,
                    '[second] exited with exit code 0.',
                    'RunStorm Summary:\n [first] succeeded.\n[second] succeeded.',
                ],
            },
        },
    ]);

    it('resolves without commands', async () => {
        assert.deepEquals(
            await runCommands([], {
                disableSummary: true,
            }),
            {
                exitCodes: [],
                highestExitCode: 0,
                terminated: false,
            },
        );
    });

    it('runs without a child-process watchdog', async () => {
        assert.deepEquals(
            await runCommands(
                [
                    {
                        command: 'echo "hi"',
                    },
                ],
                {
                    disableChildProcessWatchdog: true,
                    disableSummary: true,
                    loggers: {
                        stderr: () => undefined,
                        stdout: () => undefined,
                    },
                },
            ),
            {
                exitCodes: [0],
                highestExitCode: 0,
                terminated: false,
            },
        );
    });

    it('lets a terminated command shut down within its grace period', async () => {
        /**
         * The watchdog reaps whatever is still registered when RunStorm's standard input pipe
         * closes. Doing that the instant `runCommands` returns would SIGKILL commands that are
         * still inside their SIGTERM grace period. The marker file is the only usable evidence:
         * `worker.terminate()` has already torn down the thread that was piping the command's
         * output, so nothing the command prints after being signaled can reach these loggers.
         */
        const markerFilePath = join(tmpdir(), `runstorm-graceful-shutdown-${process.pid}.txt`);
        await rm(markerFilePath, {
            force: true,
        });
        /**
         * The shutdown delay has to outlast the watchdog's own startup, or an immediate sweep would
         * land after the marker was already written and the test would pass either way. It still
         * has to finish well inside `defaultDestroyForceKillDelayMs`.
         */
        const command = [
            'node -e "',
            "process.on('SIGTERM', () => setTimeout(() => {require('node:fs').writeFileSync(",
            `'${markerFilePath}', 'shut down cleanly'); process.exit(0);}, 1_200));`,
            "console.log('ready');",
            'setInterval(() => {}, 1_000);',
            '"',
        ].join(' ');
        const ready = new DeferredPromise();

        const promise = runCommands(
            [
                {
                    command,
                    name: 'graceful',
                },
            ],
            {
                disableSummary: true,
                loggers: {
                    stdout(output) {
                        if (output.includes('ready')) {
                            ready.resolve();
                        }
                    },
                    stderr: () => undefined,
                },
            },
        );

        await ready.promise;
        process.emit('SIGINT');
        await promise;

        try {
            await waitUntil.isTrue(
                async () => (await readFile(markerFilePath, 'utf8')) === 'shut down cleanly',
                {
                    interval: {
                        milliseconds: 50,
                    },
                    timeout: {
                        seconds: 5,
                    },
                },
            );
        } finally {
            await rm(markerFilePath, {
                force: true,
            });
        }
    });

    it('terminates running workers on SIGINT', async () => {
        const started = new DeferredPromise();
        const promise = runCommands(
            [
                {
                    command: 'echo started; sleep 60',
                    color: ColorKey.blue,
                    name: 'sleep',
                },
            ],
            {
                disableSummary: true,
                loggers: {
                    stdout(output) {
                        if (output.includes('started')) {
                            started.resolve();
                        }
                    },
                    stderr: () => undefined,
                },
            },
        );

        await started.promise;
        process.emit('SIGINT');

        const result = await promise;
        assert.isTrue(result.terminated);
    });
});
