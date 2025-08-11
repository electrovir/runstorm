import {describe, itCases} from '@augment-vir/test';
import {createCommands} from './command.js';

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
