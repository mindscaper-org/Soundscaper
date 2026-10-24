/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFreesoundUploadQueue } from '../src/common/editor/ui/workspace/freesound-upload-queue.ts';
import { encodeWav } from '../src/common/editor/wav.js';

test('uploading an edited clip after submission renders a fresh artifact instead of reusing the completed upload', async () => {
	let sample = 0.25;
	const uploaded: File[] = [];
	const queue = createFreesoundUploadQueue({
		createId: (() => { let id = 0; return () => `clip-upload-${++id}`; })(),
		materializeClip: async () => ({
			clipTitle: 'Field recording',
			file: new File([encodeWav([Float32Array.of(sample)], { sampleRate: 48_000, bitDepth: 16 })], 'field.wav'),
		}),
		upload: async file => { uploaded.push(file); return { uploadFilename: `remote-${uploaded.length}.wav` }; },
		describe: async () => ({ status: 'pending_moderation' }),
	});
	const reference = { projectId: 'field-project', clipId: 'field-clip' };
	const first = queue.enqueueClip(reference);
	assert.equal(queue.enqueueClip(reference), first, 'repeat requests for the active upload still coalesce');
	await tick();
	await queue.publish(first, { title: 'Field recording', description: 'My field recording.',
		tags: ['field', 'recording', 'audio'], categoryId: 'ss-n', license: 'cc-by', rightsConfirmed: true });
	assert.equal(queue.getSnapshot().items[0]?.status, 'submitted');
	sample = -0.5; // The same clip identity survives ordinary audio edits.
	const second = queue.enqueueClip(reference);
	assert.notEqual(second, first, 'a completed upload must not consume a new request for the edited clip');
	await tick();
	assert.equal(uploaded.length, 2);
	assert.notDeepEqual(new Uint8Array(await uploaded[0]!.arrayBuffer()), new Uint8Array(await uploaded[1]!.arrayBuffer()));
	assert.deepEqual(queue.getSnapshot().items.map(item => item.status), ['submitted', 'ready-to-publish']);
	assert.equal(queue.enqueueClip(reference), second, 'the fresh active upload remains coalesced');
});

async function tick(): Promise<void> {
	await new Promise<void>(resolve => setImmediate(resolve));
}
