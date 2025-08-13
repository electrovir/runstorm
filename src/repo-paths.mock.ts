import {join, resolve} from 'node:path';

export const repoDirPath = resolve(import.meta.dirname, '..');
export const srcDirPath = join(repoDirPath, 'src');
