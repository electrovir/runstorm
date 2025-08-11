import {assertWrap, check, checkWrap} from '@augment-vir/assert';
import {
    type ArrayElement,
    arrayToObject,
    filterMap,
    type FirstLetterCase,
    getOrSet,
    setFirstLetterCasing,
    StringCase,
} from '@augment-vir/common';
import styles, {type CSPair, type ForegroundColorName} from 'ansi-styles';

/**
 * A finalized command to run for RunStorm.
 *
 * @category Internal
 */
export type Command = {
    command: string;
    name: string;
    color: ColorKey;
};

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
            const commandName = commandNames[index] || command.split(' ', 1)[0];
            if (!commandName) {
                return undefined;
            }

            const nameUsageCount = getOrSet(usedCommandNames, commandName, () => 1);
            const commandNameWithCount = [
                commandName,
                nameUsageCount > 1 ? nameUsageCount : '',
            ]
                .filter(check.isTruthy)
                .join(' ');
            usedCommandNames[commandName] = nameUsageCount + 1;

            const colorKey: ColorKey = assertWrap.isDefined(
                checkWrap.isKeyOf(commandColors[index] || '', allColorsByKey) ||
                    colorKeys[index % colorKeys.length],
                'failed to find color key',
            );

            return {
                command,
                name: commandNameWithCount,
                color: colorKey,
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
export const colorKeys = [
    ...basicColorKeys,
    ...inverseColorKeys,
];

/**
 * All supported color keys for logging.
 *
 * @category Internal
 */
export type ColorKey = ArrayElement<typeof colorKeys>;

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
