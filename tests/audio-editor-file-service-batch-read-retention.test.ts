/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('batch-owned read capabilities survive successful and failed temporary imports until explicitly released', async () => {
	const released: string[] = [];
	const descriptor = { id: 'batch-input', readProfile: 'materialized-v1', url: 'https://input.test/recording', name: 'input.wav', size: 1 };
	const service = createAudioEditorFileService({
		bridge: { releaseRead: async (id: string) => { released.push(id); } },
		fetch: () => Promise.resolve(new Response('x', { headers: { 'Content-Length': '1' } })),
	});
	assert.equal(await service.withReadDescriptors([descriptor], { retainReads: true }, async ([file]: readonly File[]) => file.text()), 'x');
	assert.deepEqual(released, []);
	await assert.rejects(service.withReadDescriptors([descriptor], { retainReads: true }, async () => { throw new Error('Import failed'); }), /Import failed/u);
	assert.deepEqual(released, []);
	assert.equal(await service.withReadDescriptors([descriptor], { retainReads: true }, async ([file]: readonly File[]) => file.text()), 'x');
	await service.releaseRead(descriptor.id);
	assert.deepEqual(released, ['batch-input']);
});
