import {describe, it} from '@augment-vir/test';

describe('index', () => {
    it('imports', async () => {
        await import('./index.js');
    });
});
