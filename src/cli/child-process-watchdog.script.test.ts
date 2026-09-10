import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {DeferredPromise} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {
    isChildProcessTreeRunning,
    stopChildProcessTree,
} from '../child-process-watchdog/process-tree.js';
import {WatchdogMessageType} from '../child-process-watchdog/watchdog-data.js';

function createWatchdogStartupArgs() {
    return import.meta.filename.endsWith('.ts')
        ? [
              '--no-warnings',
              '--import',
              createRequire(import.meta.url).resolve('tsx'),
              resolve(import.meta.dirname, './child-process-watchdog.script.ts'),
          ]
        : [
              resolve(import.meta.dirname, './child-process-watchdog.script.js'),
          ];
}

/**
 * A stand-in for RunStorm itself: it starts a command that traps SIGTERM, hands the command's
 * process ID to a real watchdog over the real standard input pipe, prints that ID, and then waits
 * to be killed. Only a separate process can exercise the watchdog's actual purpose, since the whole
 * mechanism hinges on the parent's death closing the pipe.
 */
function createParentProcessScript() {
    const stubbornCommand = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000);";

    return [
        "const {spawn} = require('node:child_process');",
        `const command = spawn(process.execPath, ['-e', ${JSON.stringify(stubbornCommand)}], {`,
        '    detached: true,',
        "    stdio: 'ignore',",
        '});',
        `const watchdog = spawn(process.execPath, ${JSON.stringify(createWatchdogStartupArgs())}.concat([`,
        "    '--parent-process-id=' + process.pid,",
        "    '--shutdown-grace-ms=0',",
        ']), {',
        '    detached: true,',
        "    stdio: ['pipe', 'ignore', 'ignore'],",
        '});',
        `const message = JSON.stringify({type: ${JSON.stringify(WatchdogMessageType.ChildProcessStarted)}, childProcessId: command.pid});`,
        String.raw`watchdog.stdin.write(message + '\n', () => {`,
        '    command.unref();',
        '    watchdog.unref();',
        '    watchdog.stdin.unref();',
        String.raw`    process.stdout.write(command.pid + '\n');`,
        '});',
        'setInterval(() => {}, 1_000);',
    ].join('\n');
}

describe('child-process-watchdog.script.ts', () => {
    it('kills a running command once its parent process dies', async () => {
        const parentProcess = spawn(process.execPath, [
            '-e',
            createParentProcessScript(),
        ]);
        const commandProcessId = new DeferredPromise<number>();
        assertWrap.isDefined(parentProcess.stdout).once('data', (chunk: Buffer) => {
            commandProcessId.resolve(Number(chunk.toString().trim()));
        });

        const childProcessId = await commandProcessId.promise;

        try {
            assert.isTrue(Number.isSafeInteger(childProcessId) && childProcessId > 1);
            assert.isTrue(isChildProcessTreeRunning(childProcessId));

            /**
             * SIGKILL leaves the parent no chance to clean up, so anything that survives is proof
             * that the detached watchdog did the reaping.
             */
            parentProcess.kill('SIGKILL');

            await waitUntil.isFalse(() => isChildProcessTreeRunning(childProcessId), {
                interval: {
                    milliseconds: 100,
                },
                timeout: {
                    seconds: 10,
                },
            });
        } finally {
            /** The command traps SIGTERM, so a leaked one would outlive the whole test run. */
            stopChildProcessTree(childProcessId, 'SIGKILL');
        }
    });
});
