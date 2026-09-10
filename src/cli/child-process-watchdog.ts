import {assertWrap} from '@augment-vir/assert';
import {ArgValueType, FlagRequirement, parseArgs} from 'cli-vir';
import {startChildProcessWatchdog} from '../child-process-watchdog/watchdog.js';

/**
 * Runs RunStorm's detached child-process watchdog CLI command.
 *
 * @category Internal
 */
export function runChildProcessWatchdogCli(
    rawArgs: ReadonlyArray<string>,
    importMeta: Readonly<ImportMeta>,
) {
    const args = parseArgs(
        rawArgs,
        {
            parentProcessId: {
                type: ArgValueType.Number,
                description:
                    'The RunStorm process to watch. Write detached command PIDs to standard input.',
                flag: {
                    valueRequirement: FlagRequirement.Required,
                },
            },
            shutdownGraceMs: {
                type: ArgValueType.Number,
                description:
                    "How long to wait after the parent's planned exit before killing commands that are still shutting down.",
                flag: {
                    valueRequirement: FlagRequirement.Required,
                },
            },
        },
        {
            binName: 'runstorm-child-process-watchdog',
            commandDescription: 'Stops detached RunStorm commands after their parent exits.',
            importMeta,
        },
    );

    startChildProcessWatchdog({
        parentProcessId: assertWrap.isNumber(args.parentProcessId),
        shutdownGraceMs: assertWrap.isNumber(args.shutdownGraceMs),
    });
}
