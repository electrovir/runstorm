#!/usr/bin/env node

import {runChildProcessWatchdogCli} from './child-process-watchdog.js';

runChildProcessWatchdogCli(process.argv, import.meta);
