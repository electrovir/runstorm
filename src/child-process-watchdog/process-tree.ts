// cspell:word taskkill
import {check} from '@augment-vir/assert';
import {currentOperatingSystem, OperatingSystem} from '@augment-vir/node';
import {spawn} from 'node:child_process';
import {join} from 'node:path';

/**
 * Checks whether a process ID is currently active.
 *
 * @category Internal
 */
export function isProcessRunning(processId: number) {
    try {
        process.kill(processId, 0);
        return true;
    } catch (error) {
        /**
         * `EPERM` means the process exists but belongs to another user, so it _is_ running. Every
         * other failure (`ESRCH`) means it is gone. Treating `EPERM` as "gone" would make the
         * watchdog conclude that its parent had died and kill every command mid-run.
         */
        return check.hasKey(error, 'code') && error.code === 'EPERM';
    }
}

function isPosixProcessGroupRunning(processGroupId: number) {
    return isProcessRunning(-processGroupId);
}

function stopPosixProcessGroup(processGroupId: number, signal: NodeJS.Signals) {
    try {
        process.kill(-processGroupId, signal);
    } catch {
        // The process group has already exited.
    }
}

/* node:coverage ignore next 26: only executes on Windows. */
function stopWindowsProcessTree(processId: number, signal: NodeJS.Signals) {
    /**
     * Windows has no signal delivery. `taskkill /T` walks the tree and asks each process to close,
     * which is the closest equivalent to SIGTERM; adding `/F` terminates them outright, which is
     * the SIGKILL equivalent. Any signal other than SIGKILL is therefore treated as the graceful
     * request so that `ShellWorker.destroy`'s escalation has both of its rungs here too.
     */
    const taskkillProcess = spawn(
        join(process.env.SystemRoot || String.raw`C:\Windows`, 'System32', 'taskkill.exe'),
        [
            '/PID',
            `${processId}`,
            '/T',
            ...(signal === 'SIGKILL'
                ? [
                      '/F',
                  ]
                : []),
        ],
        {
            detached: true,
            stdio: 'ignore',
        },
    );
    taskkillProcess.unref();
}

const isChildProcessTreeRunningByOperatingSystem: Record<
    OperatingSystem,
    (processId: number) => boolean
> = {
    [OperatingSystem.Linux]: isPosixProcessGroupRunning,
    [OperatingSystem.Mac]: isPosixProcessGroupRunning,
    [OperatingSystem.Windows]: isProcessRunning,
};

const stopChildProcessTreeByOperatingSystem: Record<
    OperatingSystem,
    (processId: number, signal: NodeJS.Signals) => void
> = {
    [OperatingSystem.Linux]: stopPosixProcessGroup,
    [OperatingSystem.Mac]: stopPosixProcessGroup,
    [OperatingSystem.Windows]: stopWindowsProcessTree,
};

/**
 * Checks whether a command process, including its detached process group where supported, runs.
 * Windows has no process group to probe, so only the root command process is checked there.
 *
 * @category Internal
 */
export function isChildProcessTreeRunning(processId: number) {
    return isChildProcessTreeRunningByOperatingSystem[currentOperatingSystem](processId);
}

/**
 * Stops a command process and its descendants on the current operating system.
 *
 * @category Internal
 */
export function stopChildProcessTree(processId: number, signal: NodeJS.Signals) {
    stopChildProcessTreeByOperatingSystem[currentOperatingSystem](processId, signal);
}
