# RunStorm

Easily run multiple commands in parallel threads.

Reference docs: http://electrovir.github.io/runstorm

## Install

```sh
npm i -D runstorm
```

## CLI

List the commands to run in parallel:

```
npx runstorm "echo 'command 1'" "sleep 2 && echo 'command 2'"
```

Run `npx runstorm --help` to see additional options.

## API

Commands can be run with `runCommands`:

<!-- example-link: src/readme-examples/run-commands.example.ts -->

```TypeScript
import {ColorKey, runCommands} from 'runstorm';

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
```
