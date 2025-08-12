import {ColorKey, runCommands} from '../index.js';

await runCommands([
    {
        command: 'echo "command 1"',
        color: ColorKey.red,
    },
    {
        command: 'sleep 2 && echo "command 2"',
        color: ColorKey.blue,
        name: 'delayed',
    },
]);
