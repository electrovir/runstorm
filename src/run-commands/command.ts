import {check, checkWrap} from '@augment-vir/assert';
import {filterMap, getOrSet, type PartialWithUndefined} from '@augment-vir/common';
import {type SetOptional} from 'type-fest';
import {allColorsByKey, getColorKeyByIndex, type ColorKey} from './color-key.js';

/**
 * A finalized command to run for RunStorm.
 *
 * @category Internal
 */
export type Command = {
    command: string;
    name: string;
    color: ColorKey;
} & PartialWithUndefined<{
    cwd?: string;
}>;

/**
 * Convert raw CLI input strings into {@link Command} outputs.
 *
 * @category Internal
 */
export function createCommands({
    commandStrings,
    commandNames,
    commandColors,
}: Readonly<{
    commandStrings: ReadonlyArray<string>;
    commandNames: ReadonlyArray<string>;
    commandColors: ReadonlyArray<string>;
}>): Command[] {
    const usedCommandNames: {[CommandName in string]: number} = {};

    return filterMap(
        commandStrings,
        (command, index): Command | undefined => {
            const commandName = generateCommandName({
                usedCommandNames,
                givenName: commandNames[index],
                command,
            });

            if (!commandName) {
                return undefined;
            }

            const colorKey: ColorKey =
                checkWrap.isKeyOf(commandColors[index] || '', allColorsByKey) ||
                getColorKeyByIndex(index);

            return {
                command,
                name: commandName,
                color: colorKey,
            };
        },
        check.isTruthy,
    );
}

function generateCommandName({
    usedCommandNames,
    givenName,
    command,
}: {
    usedCommandNames: {
        [CommandName in string]: number;
    };
    givenName: string | undefined;
    command: string;
}): string | undefined {
    const commandName: string | undefined = givenName || command.split(' ', 1)[0];
    if (!commandName) {
        return undefined;
    }

    usedCommandNames[commandName] = getOrSet(usedCommandNames, commandName, () => 0) + 1;
    const commandNameWithCount = [
        commandName,
        usedCommandNames[commandName] > 1 ? usedCommandNames[commandName] : '',
    ]
        .filter(check.isTruthy)
        .join(' ');

    return commandNameWithCount;
}

/**
 * Converts partial command objects into full command objects.
 *
 * @category Internal
 */
export function sanitizeCommands(
    commands: ReadonlyArray<Readonly<SetOptional<Command, 'color' | 'name'>>>,
): Command[] {
    const usedCommandNames: {[CommandName in string]: number} = {};

    return filterMap(
        commands,
        (command, commandIndex): Command | undefined => {
            const commandName = generateCommandName({
                usedCommandNames,
                givenName: command.name,
                command: command.command,
            });

            if (!commandName) {
                return undefined;
            }

            return {
                color: getColorKeyByIndex(commandIndex),
                ...command,
                name: commandName,
            };
        },
        check.isTruthy,
    );
}
