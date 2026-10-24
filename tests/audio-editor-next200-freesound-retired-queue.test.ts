/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFreesoundUploadQueue } from '../src/common/editor/ui/workspace/freesound-upload-queue.ts';

test('a signed-out account cannot hold the replacement account upload queue while decoding finishes', async () => {
	const oldPreparation = Promise.withResolvers<File>();
	const freshUpload = Promise.withResolvers<Readonly<{ uploadFilename: string }>>();
	const started: string[] = [];
	let oldSignal: AbortSignal | undefined;
	const queue = createFreesoundUploadQueue({
		createId: (() => { let id = 0; return () => `account-upload-${++id}`; })(),
		prepareFile: (_file, signal) => { oldSignal = signal; return oldPreparation.promise; },
		upload: file => { started.push(file.name); return freshUpload.promise; },
		describe: async () => ({ status: 'pending_moderation' }),
	});
	queue.enqueueFiles([new File(['native encoded programme'], 'old-account.m4a')]);
	assert.equal(queue.getSnapshot().items[0]?.status, 'preparing');
	queue.clear(); // Disconnect and account replacement both retire this queue.
	assert.equal(oldSignal?.aborted, true);
	assert.equal(queue.getSnapshot().active, false, 'retired decoding must release the foreground queue');
	queue.enqueueFiles([new File(['fresh recording'], 'new-account.wav')]);
	assert.deepEqual(started, ['new-account.wav']);
	assert.equal(queue.getSnapshot().active, true);

	oldPreparation.resolve(new File(['old decoded PCM'], 'old-account.wav'));
	await tick();
	assert.deepEqual(started, ['new-account.wav'], 'a retired decoder must never upload into the replacement account');
	assert.equal(queue.getSnapshot().active, true, 'old cleanup must not clear the replacement upload busy state');
	assert.equal(queue.getSnapshot().items[0]?.status, 'uploading');
	freshUpload.resolve({ uploadFilename: 'new-remote.wav' });
	await tick();
	assert.equal(queue.getSnapshot().active, false);
	assert.equal(queue.getSnapshot().items[0]?.status, 'ready-to-publish');
	assert.equal(queue.getSnapshot().items[0]?.uploadFilename, 'new-remote.wav');
});

async function tick(): Promise<void> {
	await new Promise<void>(resolve => setImmediate(resolve));
}
