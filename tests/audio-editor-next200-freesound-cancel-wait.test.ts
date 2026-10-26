/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred } from './helpers/async-test-control.ts';

import { createFreesoundUploadQueue } from '../src/common/editor/ui/workspace/freesound-upload-queue.ts';
import { prepareFreesoundUploadFile } from '../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts';
import { encodeWav } from '../src/common/editor/wav.js';

test('Cancel closes the native context while its uncancellable decode result is still pending', async () => {
	const signal = new AbortController(), pending = deferred<AudioBuffer>(), started = deferred<void>();
	let closes = 0;
	const file = new File([Uint8Array.from(encodeWav([Float32Array.of(.25, -.25)], { sampleRate: 48_000 })).buffer], 'recording.wave');
	const operation = prepareFreesoundUploadFile(file, signal.signal, { createDecodeContext: () => ({
		decodeAudioData: () => { started.resolve(); return pending.promise; },
		close: async () => { closes++; },
	}) });
	const cancelled = assert.rejects(operation, { name: 'AbortError' });
	try {
		await started.promise;
		signal.abort();
		await tick();
		assert.equal(closes, 1, 'the retired native context must not keep device resources until decoding finishes');
	} finally {
		pending.resolve({ length: 2, sampleRate: 48_000, numberOfChannels: 1,
			getChannelData: () => Float32Array.of(.25, -.25) } as unknown as AudioBuffer);
		await cancelled;
	}
	assert.equal(closes, 1, 'late decoder completion must not close the context twice');
});

test('Cancel releases an encoded upload before its uncancellable native decoder finishes', async () => {
	const decoding = deferred<File>();
	const uploaded: string[] = [];
	const queue = createFreesoundUploadQueue({
		createId: (() => { let id = 0; return () => `cancel-upload-${++id}`; })(),
		prepareFile: () => decoding.promise,
		upload: async file => { uploaded.push(file.name); return { uploadFilename: file.name }; },
		describe: async () => ({ status: 'pending_moderation' }),
	});
	const [encoded, wav] = queue.enqueueFiles([new File(['encoded'], 'first.m4a'), new File(['PCM'], 'second.wav')]);
	queue.cancel(encoded!);
	await tick();
	assert.equal(queue.getSnapshot().items.find(item => item.id === encoded)?.status, 'cancelled');
	assert.equal(queue.getSnapshot().items.find(item => item.id === wav)?.status, 'ready-to-publish');
	assert.deepEqual(uploaded, ['second.wav'], 'the next healthy file must proceed without the cancelled decode result');
	decoding.resolve(new File(['retired PCM'], 'first.wav'));
	await tick();
	assert.deepEqual(uploaded, ['second.wav']);
	assert.equal(queue.getSnapshot().items[0]?.status, 'cancelled');
});

test('a late publish reply cannot turn a cancelled upload into a submitted upload', async () => {
	const reply = deferred<Readonly<{ status: string; soundId: number }>>();
	const queue = createFreesoundUploadQueue({
		createId: () => 'cancel-publication',
		upload: async () => ({ uploadFilename: 'field.wav' }),
		describe: () => reply.promise,
	});
	queue.enqueueFiles([new File(['PCM'], 'field.wav')]);
	await tick();
	const operation = queue.publish('cancel-publication', {
		title: 'Field', description: 'My field recording.', tags: ['field', 'audio', 'nature'],
		categoryId: 'ss-n', license: 'cc-by', rightsConfirmed: true,
	});
	const cancelled = assert.rejects(operation, { name: 'AbortError' });
	queue.cancel('cancel-publication');
	await tick();
	assert.equal(queue.getSnapshot().items[0]?.status, 'cancelled');
	reply.resolve({ status: 'pending_moderation', soundId: 42 });
	await cancelled;
	await tick();
	assert.equal(queue.getSnapshot().items[0]?.status, 'cancelled');
	assert.equal(queue.getSnapshot().items[0]?.soundId, undefined);
});

async function tick(): Promise<void> {
	await new Promise<void>(resolve => setImmediate(resolve));
}
