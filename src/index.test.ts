import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';

describe('index.ts', () => {
    it('imports', async () => {
        const imported = await import('./index.js');

        assert.isLengthAtLeast(Object.keys(imported), 1);
    });
});
