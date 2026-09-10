import {assert, waitUntil} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {spawnExitedProcessId, spawnStubbornProcessId} from './detached-process.mock.js';
import {isChildProcessTreeRunning, isProcessRunning, stopChildProcessTree} from './process-tree.js';

describe(isProcessRunning.name, () => {
    it('detects a running and an exited process', async () => {
        const stubbornProcessId = spawnStubbornProcessId();

        try {
            assert.isTrue(isProcessRunning(stubbornProcessId));
            assert.isFalse(isProcessRunning(await spawnExitedProcessId()));
        } finally {
            stopChildProcessTree(stubbornProcessId, 'SIGKILL');
        }
    });
    it('counts a process owned by another user as running', () => {
        /**
         * Signaling PID 1 fails with `EPERM` rather than `ESRCH` for any non-root user. Reporting
         * that as "not running" is how a watchdog would wrongly conclude its parent had died.
         */
        assert.isTrue(isProcessRunning(1));
    });
});

describe(stopChildProcessTree.name, () => {
    it('stops a detached process tree', async () => {
        const stubbornProcessId = spawnStubbornProcessId();
        assert.isTrue(isChildProcessTreeRunning(stubbornProcessId));

        stopChildProcessTree(stubbornProcessId, 'SIGKILL');

        await waitUntil.isFalse(() => isChildProcessTreeRunning(stubbornProcessId), {
            interval: {
                milliseconds: 50,
            },
            timeout: {
                seconds: 5,
            },
        });
        /** Signaling a tree that is already gone is normal and must not throw. */
        stopChildProcessTree(await spawnExitedProcessId(), 'SIGKILL');
    });
});
