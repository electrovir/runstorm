import {assertWrap, check, checkWrap} from '@augment-vir/assert';
import {
    type ArrayElement,
    arrayToObject,
    filterMap,
    type FirstLetterCase,
    getOrSet,
    type PartialWithUndefined,
    setFirstLetterCasing,
    StringCase,
} from '@augment-vir/common';
import styles, {type CSPair, type ForegroundColorName} from 'ansi-styles';
import {type SetOptional} from 'type-fest';

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
export function createCommands(
    commandStrings: ReadonlyArray<string>,
    commandNames: ReadonlyArray<string>,
    commandColors: ReadonlyArray<string>,
): Command[] {
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

            const colorKey: ColorKey = assertWrap.isDefined(
                checkWrap.isKeyOf(commandColors[index] || '', allColorsByKey) ||
                    allColorKeys[index % allColorKeys.length],
                'failed to find color key',
            );

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
                color: assertWrap.isDefined(
                    allColorKeys[commandIndex % allColorKeys.length],
                    'failed to find color key',
                ),
                ...command,
                name: commandName,
            };
        },
        check.isTruthy,
    );
}

/**
 * Supported basic color keys for logging.
 *
 * @category Internal
 */
export const basicColorKeys = [
    'red',
    'yellow',
    'green',
    'cyan',
    'blue',
    'magenta',
    'black',
    'white',
] as const satisfies ForegroundColorName[];

/**
 * Supported basic color keys for logging.
 *
 * @category Internal
 */
export type BasicColorKey = ArrayElement<typeof basicColorKeys>;
/**
 * Supported inverted (colored background) color keys for logging.
 *
 * @category Internal
 */
export type InverseColorKey = `bg${FirstLetterCase<StringCase.Upper, BasicColorKey>}`;

/**
 * Supported inverted (colored background) color keys for logging.
 *
 * @category Internal
 */
export const inverseColorKeys = basicColorKeys.map(
    (colorKey) => `bg${setFirstLetterCasing(colorKey, StringCase.Upper)}`,
) satisfies string[] as InverseColorKey[];

/**
 * All supported color keys for logging.
 *
 * @category Internal
 */
export const allColorKeys = [
    ...basicColorKeys,
    ...inverseColorKeys,
];

/**
 * All supported color keys for logging.
 *
 * @category Internal
 */
export type ColorKey = ArrayElement<typeof allColorKeys>;

/**
 * All supported color keys for logging.
 *
 * @category Internal
 */
export const ColorKey = arrayToObject(
    allColorKeys,
    (value) => {
        return {
            key: value,
            value,
        };
    },
    {
        useRequired: true,
    },
) satisfies Record<ColorKey, string> as {[Key in ColorKey]: Key};

const basicColors: Record<BasicColorKey, CSPair[]> = arrayToObject(
    basicColorKeys,
    (colorKey) => {
        return {
            key: colorKey,
            value: [
                styles[colorKey],
            ],
        };
    },
    {useRequired: true},
);
const inverseColors: Record<InverseColorKey, CSPair[]> = arrayToObject(
    basicColorKeys,
    (colorKey) => {
        return {
            key: `bg${setFirstLetterCasing(colorKey, StringCase.Upper)}`,
            value: [
                styles[colorKey],
                styles.inverse,
            ],
        };
    },
    {
        useRequired: true,
    },
);

/**
 * All supported color keys for logging by their color key.
 *
 * @category Internal
 */
export const allColorsByKey = {
    ...basicColors,
    ...inverseColors,
};
