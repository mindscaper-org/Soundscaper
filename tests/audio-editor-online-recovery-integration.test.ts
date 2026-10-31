/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadFreesoundImport } from '../src/common/editor/controller/import/internal/freesound-import-download.ts';
import { createAudiocomUploadQueue } from '../src/common/editor/controller/import/internal/audiocom-upload-queue.ts';
import type { AudiocomApiClient, AudiocomUploadDraft } from '../src/common/editor/controller/import/audiocom-panel-session.ts';

const draft: AudiocomUploadDraft = { title: 'Audio', description: '', category: 'recording', license: 'arr', visibility: 'unlisted', downloadable: false, rightsConfirmed: true };

test('Freesound retries an interrupted complete download before importing any partial bytes', async () => {
	let calls = 0;
	const result = await downloadFreesoundImport({
		sound: { id: 1, name: 'one.ogg', preview: { available: true }, originalFile: { byteLength: 4, format: 'ogg' } },
		variant: 'preview-hq-ogg', maximumOriginalBytes: 100, maximumPreviewBytes: 100,
		url: new URL('https://soundscaper.org/api/freesound/sounds/1/preview'),
		fetch: async () => {
			calls += 1; let chunks = 0;
			return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
				chunks += 1;
				if (calls === 1 && chunks === 2) controller.error(new TypeError('connection closed'));
				else if (chunks === 1) controller.enqueue(Uint8Array.of(1, 2, 3, 4));
				else controller.close();
			} }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'audio/ogg' } });
		},
	});
	assert.equal(calls, 2); assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), Uint8Array.of(1, 2, 3, 4));
});

test('cancelling an ignored audio.com upload abort releases the next queued item', async () => {
	let first = true, uploads = 0;
	const client: Pick<AudiocomApiClient, 'upload'> = { upload: async () => { uploads += 1;
		if (first) { first = false; return new Promise<never>(() => undefined); }
		return { audio: { id: '1', url: 'https://audio.com/one', title: 'One', authorName: '', username: '', description: '', license: 'arr', isDownloadable: false, durationSeconds: 0 }, processing: true };
	} };
	const queue = createAudiocomUploadQueue(client, () => true, () => undefined, () => undefined);
	const [firstId, secondId] = queue.enqueueFiles([new File(['1'], 'one.wav'), new File(['2'], 'two.wav')]);
	assert.ok(firstId); assert.ok(secondId);
	const uploading = queue.publish(firstId, draft); await queue.publish(secondId, draft); queue.cancel(firstId);
	await uploading;
	assert.equal(uploads, 2); assert.deepEqual(queue.snapshot().items.map(item => item.status), ['cancelled', 'processing']);
	queue.dispose();
});
