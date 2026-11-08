/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createAudiocomPanelSession } from '../src/common/editor/controller/import/audiocom-panel-session.ts';
import { createAudiocomApiClient } from '../src/common/editor/controller/import/internal/audiocom-api-client.ts';
import { parseUploadInput } from '../functions/api/audiocom/_shared/contracts.ts';
import { encodeWav } from '../src/common/editor/wav.js';

for (const extension of ['wav', 'wave', 'rf64', 'bw64']) test(`audio.com sends maintained WAVE alias .${extension} through its native MIME contract`, async () => {
	const bytes = Uint8Array.from(encodeWav([new Float32Array(48).fill(.25)], { sampleRate: 48_000 }));
	const file = new File([bytes], `Field take.${extension}`);
	const sent: Request[] = [];
	const client = createAudiocomApiClient({ location: { protocol: 'https:', origin: 'https://soundscaper.org' },
		fetch: async (input, init) => {
			const request = new Request(input, init);
			const path = new URL(request.url).pathname;
			if (path.endsWith('/oauth/session')) return Response.json({ data: { connected: true } });
			if (path.endsWith('/usage')) return Response.json({ data: {} });
			assert.ok(path.endsWith('/uploads')); sent.push(request);
			const admitted = parseUploadInput(request);
			assert.equal(admitted.name, file.name); assert.equal(admitted.mime, 'audio/wav');
			assert.deepEqual(new Uint8Array(await request.arrayBuffer()), bytes);
			return Response.json({ data: { processing: false, audio: { id: '123', title: 'Field take', authorName: 'Recorder', username: 'recorder',
				url: 'https://audio.com/recorder/audio/field-take', description: '', license: 'arr', isDownloadable: false, durationSeconds: .001 } } });
		} });
	const session = createAudiocomPanelSession({ client });
	try {
		await session.initialize();
		const [id] = session.enqueueFiles([file]); assert.ok(id);
		await session.publish(id, { title: 'Field take', description: '', category: 'recording', license: 'arr',
			visibility: 'unlisted', downloadable: false, rightsConfirmed: true });
		for (let attempts = 0; session.getSnapshot().uploadQueue.active; attempts++) {
			assert.ok(attempts < 100); await setImmediate();
		}
		assert.equal(sent.length, 1);
		assert.equal(session.getSnapshot().uploadQueue.items[0]?.status, 'complete');
		assert.throws(() => session.enqueueFiles([new File([bytes], 'Session.aup3', { type: 'audio/wav' })]), /supported audio/u);
	} finally { session.dispose(); }
});

test('queued WAVE aliases keep their own filename, length and PCM body when published in succession', async () => {
	const files = ['wave', 'rf64', 'bw64'].map((extension, index) => new File([
		Uint8Array.from(encodeWav([new Float32Array(48 + index).fill((index + 1) / 8)], { sampleRate: 48_000 })),
	], `Distinct take.${extension}`));
	const sent: string[] = [];
	const client = createAudiocomApiClient({ location: { protocol: 'https:', origin: 'https://soundscaper.org' },
		fetch: async (input, init) => {
			const request = new Request(input, init), path = new URL(request.url).pathname;
			if (path.endsWith('/oauth/session')) return Response.json({ data: { connected: true } });
			if (path.endsWith('/usage')) return Response.json({ data: {} });
			const admitted = parseUploadInput(request), file = files[sent.length]; assert.ok(file);
			assert.equal(admitted.name, file.name); assert.equal(admitted.mime, 'audio/wav');
			assert.equal(request.headers.get('x-audiocom-content-length'), String(file.size));
			assert.deepEqual(new Uint8Array(await request.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
			sent.push(file.name);
			return Response.json({ data: { processing: false, audio: { id: String(sent.length), title: file.name, authorName: 'Recorder', username: 'recorder',
				url: 'https://audio.com/recorder/audio/field-take', description: '', license: 'arr', isDownloadable: false, durationSeconds: .001 } } });
		} });
	const session = createAudiocomPanelSession({ client });
	try {
		await session.initialize(); const ids = session.enqueueFiles(files); assert.equal(ids.length, files.length);
		for (const id of ids) {
			await session.publish(id, { title: 'Distinct take', description: '', category: 'recording', license: 'arr', visibility: 'unlisted', downloadable: false, rightsConfirmed: true });
			for (let attempts = 0; session.getSnapshot().uploadQueue.active; attempts++) { assert.ok(attempts < 100); await setImmediate(); }
		}
		assert.deepEqual(sent, files.map(file => file.name));
		assert.deepEqual(session.getSnapshot().uploadQueue.items.map(item => item.status), files.map(() => 'complete'));
	} finally { session.dispose(); }
});
