import {
    LogOutputType,
    mapEnumToObject,
    removeColor,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {describe, it, itCases} from '@augment-vir/test';
import {KillOn, runRawCommands, type RunCommandOptions} from './run-commands.js';

describe(runRawCommands.name, () => {
    async function testCommands(
        commands: ReadonlyArray<string>,
        options: Readonly<
            RunCommandOptions &
                PartialWithUndefined<{
                    keepColor: boolean;
                }>
        > = {},
    ) {
        const logs = mapEnumToObject(LogOutputType, () => [] as string[]);

        await runRawCommands(commands, {
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
                    '\x1b[31m[echo]\x1b[0m \x1b[34m one\x1b[0m',
                    '\x1b[31m[echo]\x1b[0m \x1b[34m two\x1b[0m\x1b[0m',
                    '\x1b[31m[echo]\x1b[0m three\x1b[0m',
                    '\x1b[31m[echo]\x1b[0m exited with exit code 0.\x1b[0m',
                    // cspell:word msucceeded
                    '\x1b[1mRunStorm Summary:\x1b[0m\n\x1b[31m[echo]\x1b[0m \x1b[32m\x1b[1msucceeded.\x1b[0m',
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
