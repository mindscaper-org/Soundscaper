/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createAudiocomPanelSession } from '../src/common/editor/controller/import/audiocom-panel-session.ts';
import { createAudiocomApiClient } from '../src/common/editor/controller/import/internal/audiocom-api-client.ts';
import { parseUploadInput } from '../functions/api/audiocom/_shared/contracts.ts';
import { OAuthHttpError } from '../functions/api/audiocom/_shared/oauth-http.ts';
import { encodeWav } from '../src/common/editor/wav.js';

for (const [original, transferred] of [['Voice\ntake.wav', 'Voice-take.wav'], ['Voice\\take.wav', 'Voice-take.wav'],
	['Voice\u007ftake.wav', 'Voice-take.wav'], ['Voice.wav', 'Voice.wav']] as const) {
	test(`audio.com publishes disk filename ${JSON.stringify(original)} without changing its display or audio`, async () => {
		const bytes = Uint8Array.from(encodeWav([new Float32Array(48).fill(.25)], { sampleRate: 48_000 }));
		const file = new File([bytes], original, { type: 'audio/wav', lastModified: 123456 });
		const uploads: string[] = [];
		const client = createAudiocomApiClient({ location: { protocol: 'https:', origin: 'https://soundscaper.org' }, fetch: async (input, init) => {
			const request = new Request(input, init); const path = new URL(request.url).pathname;
			if (path.endsWith('/oauth/session')) return Response.json({ data: { connected: true } });
			if (path.endsWith('/usage')) return Response.json({ data: {} });
			assert.ok(path.endsWith('/uploads'));
			let admitted;
			try { admitted = parseUploadInput(request); }
			catch (error) {
				if (!(error instanceof OAuthHttpError)) throw error;
				return Response.json({ error: { message: error.message, code: error.code } }, { status: error.status });
			}
			assert.equal(admitted.name, transferred); assert.equal(admitted.mime, 'audio/wav');
			assert.ok(init?.body instanceof File); assert.equal(init.body.lastModified, file.lastModified);
			assert.deepEqual(new Uint8Array(await request.arrayBuffer()), bytes); uploads.push(admitted.name);
			return Response.json({ data: { processing: false, audio: { id: '123', title: 'Voice', authorName: 'Recorder', username: 'recorder',
				url: 'https://audio.com/recorder/audio/voice', description: '', license: 'arr', isDownloadable: false, durationSeconds: .001 } } });
		} });
		const session = createAudiocomPanelSession({ client });
		try {
			await session.initialize(); const [id] = session.enqueueFiles([file]); assert.ok(id);
			await session.publish(id, { title: 'Voice', description: '', category: 'recording', license: 'arr', visibility: 'unlisted', downloadable: false, rightsConfirmed: true });
			for (let attempts = 0; session.getSnapshot().uploadQueue.active; attempts++) { assert.ok(attempts < 100); await setImmediate(); }
			const item = session.getSnapshot().uploadQueue.items[0]; assert.ok(item);
			assert.equal(item.status, 'complete', item.errorMessage ?? 'The selected file should publish.'); assert.equal(item.fileName, original);
			assert.deepEqual(uploads, [transferred]);
		} finally { session.dispose(); }
	});
}
