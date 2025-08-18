import {
    LogOutputType,
    mapEnumToObject,
    removeColor,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {describe, it, itCases} from '@augment-vir/test';
import {repoDirPath, srcDirPath} from '../repo-paths.mock.js';
import {ColorKey} from './color-key.js';
import {type Command} from './command.js';
import {KillOn, runCommands, runRawCommands, type RunCommandOptions} from './run-commands.js';

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

        await runRawCommands(commands, undefined, undefined, {
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
        await runRawCommands(['echo "hi"']);
    });
});

describe(runCommands.name, () => {
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
});
