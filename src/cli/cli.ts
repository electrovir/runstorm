import {ArgValueType, FlagRequirement, parseArgs} from 'cli-vir';
import {cpus} from 'node:os';
import {allColorKeys} from '../run-commands/color-key.js';
import {createCommands} from '../run-commands/command.js';
import {KillOn, type RunCommandOptions, runCommands} from '../run-commands/run-commands.js';

/**
 * Run RunStorm directly as as a CLI. Note that this will exit the current process. If you simply
 * want to API into RunStorm, consider using `runCommands` or `runRawCommands` instead.
 *
 * @category Internal
 */
export async function runCli(
    rawArgs: ReadonlyArray<string>,
    importMeta: Readonly<ImportMeta>,
    cwd: string = process.cwd(),
) {
    const args = parseArgs(
        rawArgs,
        {
            names: {
                description:
                    'An ordered, comma separated list of names for each command, used for logging purposes.',
                flag: {
                    valueRequirement: FlagRequirement.Required,
                },
            },
            disableSummary: {
                description: 'Set this to disable to end summary.',
                flag: {
                    valueRequirement: FlagRequirement.Blocked,
                },
            },
            disableColor: {
                description: 'Disables all color logs',
                flag: {
                    valueRequirement: FlagRequirement.Blocked,
                },
            },
            disableColorPreserve: {
                description:
                    "Disable the behavior where each log line attempts to preserve the command's last coloring.",
                flag: {
                    valueRequirement: FlagRequirement.Blocked,
                },
            },
            shell: {
                description: 'The shell to run all commands in',
                flag: {
                    valueRequirement: FlagRequirement.Required,
                },
            },
            killOn: {
                type: KillOn,
                description:
                    'Whether to kill all commands when one fails or succeeds. By default, when a command finishes, the other will not be touched.',
                flag: {
                    valueRequirement: FlagRequirement.Required,
                },
            },
            colors: {
                description: `An ordered, comma separated list of colors for each command, used for logging purposes. Supported colors are: ${allColorKeys.join(',')}`,
                flag: {
                    valueRequirement: FlagRequirement.Required,
                },
            },
            maxConcurrency: {
                description:
                    'The max number of threads to run concurrently. The default is the number of CPU cores available - 1.',
                type: ArgValueType.Number,
                flag: {
                    aliases: [
                        'max',
                    ],
                    valueRequirement: FlagRequirement.Required,
                },
            },
            commands: {
                position: {
                    rest: true,
                },
            },
        },
        {
            binName: 'runstorm',
            importMeta,
            commandDescription: 'Run multiple commands in parallel in individual threads.',
        },
    );

    const options: RunCommandOptions = {
        disableSummary: args.disableSummary,
        killOn: args.killOn || undefined,
        maxConcurrency: Math.max(Math.round(args.maxConcurrency || cpus().length - 1), 1),
        cwd,
        shell: args.shell || undefined,
        disableColorPreserve: args.disableColorPreserve,
    };

    const commandNames = (args.names || '').split(',');
    const commandColors = (args.colors || '').split(',');

    const commands = createCommands(args.commands, commandNames, commandColors);

    const {highestExitCode} = await runCommands(commands, options);

    process.exit(highestExitCode);
}
