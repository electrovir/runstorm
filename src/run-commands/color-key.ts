import {assertWrap} from '@augment-vir/assert';
import {
    type ArrayElement,
    arrayToObject,
    type FirstLetterCase,
    setFirstLetterCasing,
    StringCase,
} from '@augment-vir/common';
import styles, {type CSPair, type ForegroundColorName} from 'ansi-styles';

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
 * Gets the color key for the given command index. Colors are sequentially iterated through based on
 * the given index.
 *
 * @category Internal
 */
export function getColorKeyByIndex(index: number): ColorKey {
    return assertWrap.isDefined(
        allColorKeys[index % allColorKeys.length],
        `Somehow failed to find color key by index '${index}'.`,
    );
}

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
    {
        useRequired: true,
    },
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
