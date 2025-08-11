import {removeSuffix, safeMatch, type LogOutputType, type SelectFrom} from '@augment-vir/common';
import styles from 'ansi-styles';
import {allColorsByKey, type Command} from './command.js';
import {type RunCommandOptions} from './run-commands.js';

/**
 * Logger for command execution.
 *
 * @category Internal
 */
export type CommandLogger = (this: void, output: string) => void;
/**
 * Stdout and stderr loggers for command execution.
 *
 * @category Internal
 */
export type CommandLoggers = {
    stderr: CommandLogger;
    stdout: CommandLogger;
};

/**
 * All params required for logging a command output.
 *
 * @category Internal
 */
export type CommandLogParams = {
    command: Readonly<
        SelectFrom<
            Command,
            {
                color: true;
                name: true;
            }
        >
    >;
    lastColors: Record<LogOutputType, string[]>;
    loggers: CommandLoggers;
    options: Readonly<Pick<RunCommandOptions, 'disableColorPreserve'>>;
    output: string;
    outputType: LogOutputType;
};

/**
 * Log a command output.
 *
 * @category Internal
 */
export function handleCommandLog(params: Readonly<CommandLogParams>) {
    removeSuffix({value: params.output, suffix: '\n'})
        .split('\n')
        .forEach((line) => {
            logCommandLogLine({
                ...params,
                output: line,
            });
        });
}

/**
 * Log an individual line from a command output. Used in {@link handleCommandLog}.
 *
 * @category Internal
 */
export function logCommandLogLine({
    command,
    lastColors,
    loggers,
    options,
    output,
    outputType,
}: Readonly<CommandLogParams>) {
    loggers[outputType](
        [
            createCommandLogPrefix(command),
            ...lastColors[outputType],
            output,
            styles.reset.open,
        ].join(''),
    );

    if (!options.disableColorPreserve) {
        lastColors[outputType] = getNewColors(output, lastColors[outputType]);
    }
}

// eslint-disable-next-line sonarjs/no-control-regex, no-control-regex
const colorPattern = /\x1B\[[0-?]*[ -/]*[@-~]/g;

function getNewColors(output: string, previousColors: ReadonlyArray<string>): string[] {
    const colorMatches = safeMatch(output, colorPattern);
    let currentColors = [...previousColors];

    colorMatches.forEach((colorMatch) => {
        if (colorMatch === styles.reset.open) {
            currentColors = [];
        } else {
            currentColors.push(colorMatch);
        }
    });

    return currentColors;
}

function createCommandLogPrefix(
    command: Readonly<
        SelectFrom<
            Command,
            {
                color: true;
                name: true;
            }
        >
    >,
) {
    return [
        ...allColorsByKey[command.color].map((color) => color.open),
        '[',
        command.name,
        ']',
        styles.reset.open,
        ' ',
    ].join('');
}

/**
 * Exit conditions for all commands.
 *
 * @category Internal
 */
export type Exits = (number | 'cancelled')[];

/**
 * Creates the RunStorm summary output string.
 *
 * @category Internal
 */
export function createSummary(
    commands: ReadonlyArray<
        Readonly<
            SelectFrom<
                Command,
                {
                    color: true;
                    name: true;
                }
            >
        >
    >,
    exits: Readonly<Exits>,
): string {
    const longestCommandNameLength = commands
        .map((command) => command.name)
        .reduce((longestLength, current) => {
            return Math.max(current.length, longestLength);
        }, 0);

    const summaryContents = commands
        .map((command, commandIndex) => {
            return {
                command,
                commandIndex,
            };
        })
        .toSorted((a, b) => a.command.name.localeCompare(b.command.name))
        .map(({command, commandIndex}) => {
            const exitCode =
                exits[commandIndex] ??
                /**
                 * If the exit code isn't found, that means that the run terminated before this
                 * command could even start up so it's considered cancelled.
                 */
                'cancelled';
            const prefixPad = longestCommandNameLength - command.name.length;

            return [
                ' '.repeat(prefixPad),
                createCommandLogPrefix(command),
                exitCode === 'cancelled'
                    ? styles.grey.open
                    : exitCode
                      ? styles.red.open
                      : styles.green.open,
                styles.bold.open,
                exitCode === 'cancelled' ? 'cancelled.' : exitCode ? 'failed.' : 'succeeded.',
                styles.reset.open,
            ].join('');
        })
        .join('\n');

    return `${styles.bold.open}RunStorm Summary:${styles.reset.open}\n${summaryContents}`;
}
