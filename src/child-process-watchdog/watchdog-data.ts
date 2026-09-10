import {defineShape, enumShape, optionalShape, unionShape} from 'object-shape-tester';

/**
 * Message type for messages sent to the child-process watchdog.
 *
 * @category Internal
 */
export enum WatchdogMessageType {
    /** A command process has started and must be reaped if the parent dies. */
    ChildProcessStarted = 'child-process-started',
    /** A command process has exited on its own and no longer needs reaping. */
    ChildProcessExited = 'child-process-exited',
    /**
     * The parent is exiting on purpose. This distinguishes a planned exit from a crash: after a
     * planned exit the workers have already begun their own SIGTERM to SIGKILL escalation, so the
     * watchdog must wait that out instead of killing children that are still shutting down
     * cleanly.
     */
    Shutdown = 'shutdown',
}

/**
 * Shape definition for {@link WatchdogMessage}. The message is flat rather than a discriminated
 * union so that {@link WatchdogMessageType.Shutdown}, which carries no process ID, shares one parser
 * with the two messages that do.
 *
 * @category Internal
 */
export const watchdogMessageShape = defineShape({
    type: enumShape(WatchdogMessageType),
    childProcessId: optionalShape(unionShape(undefined, -1)),
});

/**
 * A message sent to the child-process watchdog over its standard input, one JSON object per line.
 *
 * @category Internal
 */
export type WatchdogMessage = typeof watchdogMessageShape.runtimeType;
