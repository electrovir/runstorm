/* node:coverage disable: this is just for manual testing */

import {awaitedForEach, type MaybePromise} from '@augment-vir/common';
import {KillOn, runRawCommands} from './run-commands/run-commands.js';
import {ShellWorker} from './shell-worker/shell-worker.js';

const sections: {header: string; only?: boolean; callback: () => MaybePromise<unknown>}[] = [
    {
        header: 'single worker',
        async callback() {
            await ShellWorker.completeWorker('echo "hi"', {
                hookUpToConsole: true,
            });
        },
    },
    {
        header: 'all complete',
        async callback() {
            return (
                await runRawCommands({
                    commands: [
                        'echo "hi"; sleep 1; echo "hi again";',
                        'echo "bye"',
                    ],
                })
            ).highestExitCode;
        },
    },
    {
        header: 'kill all on success',
        async callback() {
            return (
                await runRawCommands({
                    commands: [
                        'echo "hi"; sleep 2; echo "hi again";',
                        'echo "bye"',
                    ],
                    options: {
                        killOn: KillOn.Success,
                    },
                })
            ).highestExitCode;
        },
    },
    {
        header: 'kill all on failure',
        async callback() {
            return (
                await runRawCommands({
                    commands: [
                        'sleep 10; echo "one";',
                        'echo "two"; exit 1;',
                    ],
                    options: {
                        killOn: KillOn.Failure,
                    },
                })
            ).highestExitCode;
        },
    },
    {
        header: 'preserves colors',
        async callback() {
            return (
                await runRawCommands({
                    commands: [
                        "echo $'\x1b[34m one'; sleep 1; echo $'two\x1b[0m'; sleep 1; echo 'three'",
                    ],
                })
            ).highestExitCode;
        },
    },
];

const hasOnly = sections.some((section) => section.only);

await awaitedForEach(sections, async (section) => {
    if (hasOnly && !section.only) {
        return;
    }

    console.info(`\n\n>>>>>>>>> ${section.header}`);
    const output = await section.callback();
    if (output != undefined) {
        console.info(output);
    }
});
