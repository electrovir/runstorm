#!/usr/bin/env node

import {assert, check} from '@augment-vir/assert';
import {type AnyObject, mapObjectValues, removeColor, selectFrom} from '@augment-vir/common';
import {interpolationSafeWindowsPath, runShellCommand, type ShellOutput} from '@augment-vir/node';
import {describe, it} from '@augment-vir/test';
import {join} from 'node:path';
import {KillOn} from '../run-commands/run-commands.js';

function cleanOutput(output: Readonly<ShellOutput>) {
    const selected = selectFrom(output, {
        stdout: true,
        stderr: true,
        exitCode: true,
    });

    return mapObjectValues(selected, (key, value) => {
        if (check.isString(value)) {
            return removeColor(value);
        } else {
            return value;
        }
    }) as AnyObject as typeof selected;
}

describe('cli.script.ts', () => {
    it('succeeds', async () => {
        const cliScriptFilePath = join(import.meta.dirname, 'cli.script.ts');

        const output = await runShellCommand(
            `tsx ${interpolationSafeWindowsPath(cliScriptFilePath)} "echo 'one' && sleep 5 && echo 'three'" "sleep 1 && echo 'two'" --disable-summary`,
        );

        assert.deepEquals(cleanOutput(output), {
            stdout: '[echo] one\n[sleep] two\n[sleep] exited with exit code 0.\n[echo] three\n[echo] exited with exit code 0.\n',
            stderr: '',
            exitCode: 0,
        });
    });
    it('fails', async () => {
        const cliScriptFilePath = join(import.meta.dirname, 'cli.script.ts');

        const output = await runShellCommand(
            `tsx ${interpolationSafeWindowsPath(cliScriptFilePath)} "exit 1" "sleep 10; echo 'one'" --kill-on ${KillOn.Failure}`,
        );

        assert.deepEquals(cleanOutput(output), {
            stdout: '\n\nRunStorm Summary:\n [exit] failed.\n[sleep] cancelled.\n\n\n',
            stderr: '[exit] exited with exit code 1.\n[sleep] exited with exit code 1 (cancelled).\n',
            exitCode: 1,
        });
    });
    it('prints a help message', async () => {
        const cliScriptFilePath = join(import.meta.dirname, 'cli.script.ts');

        const output = await runShellCommand(
            `tsx ${interpolationSafeWindowsPath(cliScriptFilePath)} --help`,
        );

        assert.isIn('NAME', removeColor(output.stdout));
        assert.isIn('runstorm', removeColor(output.stdout));
    });
});
