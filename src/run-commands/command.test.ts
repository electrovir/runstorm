import {describe, itCases} from '@augment-vir/test';
import {ColorKey, createCommands, sanitizeCommands} from './command.js';

describe(createCommands.name, () => {
    itCases(createCommands, [
        {
            it: 'adds count to duplicated names',
            inputs: [
                [
                    'hi',
                    'bye',
                ],
                [
                    'go',
                    'go',
                ],
                [],
            ],
            only: true,
            expect: [
                {
                    command: 'hi',
                    name: 'go',
                    color: 'red',
                },
                {
                    command: 'bye',
                    name: 'go 2',
                    color: 'yellow',
                },
            ],
        },
        {
            it: 'omits empty commands',
            inputs: [
                [
                    'hi',
                    '',
                ],
                [
                    'go',
                ],
                [],
            ],
            expect: [
                {
                    command: 'hi',
                    name: 'go',
                    color: 'red',
                },
            ],
        },
    ]);
});

describe(sanitizeCommands.name, () => {
    itCases(sanitizeCommands, [
        {
            it: 'adds name and color',
            input: [
                {
                    command: 'echo "hi"',
                },
                {
                    command: 'echo "hi"',
                    color: ColorKey.magenta,
                },
                {
                    command: '',
                },
            ],
            expect: [
                {
                    command: 'echo "hi"',
                    color: ColorKey.red,
                    name: 'echo',
                },
                {
                    command: 'echo "hi"',
                    color: ColorKey.magenta,
                    name: 'echo 2',
                },
            ],
        },
    ]);
});
