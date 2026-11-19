/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createFreesoundApiClient } from '../src/common/editor/ui/workspace/freesound-auth-upload-client.ts';
import { createFreesoundPanelSession } from '../src/common/editor/ui/workspace/freesound-panel-session.ts';
import { encodeWav } from '../src/common/editor/wav.js';

for (const firstStatus of [401, 503]) test(`a ${firstStatus} upload response ${firstStatus === 401 ? 'pauses the queue for reconnection' : 'keeps unrelated queued files moving'}`, async () => {
	const uploaded: string[] = [];
	const wav = Uint8Array.from(encodeWav([new Float32Array(4800), new Float32Array(4800)], { sampleRate: 48_000, bitDepth: 16, dither: false }));
	const originals = [1, 2, 3].map(index => new File([wav], `Take-${index}.wav`, { type: 'audio/wav', lastModified: index }));
	let reconnected = false;
	const client = createFreesoundApiClient({ openAuthorization() {}, request: async (path, init) => {
		if (path.endsWith('/oauth/session') || path.endsWith('/oauth/poll')) {
			if (path.endsWith('/poll')) reconnected = true;
			return data({ connected: true, user: { username: 'recorder' } });
		}
		if (path.endsWith('/oauth/start')) return data({ attemptId: 'retry', handoffToken: 'retry-handoff',
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=ordinary&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback&response_type=code&state=retry' });
		if (path.endsWith('/uploads/pending')) return data({ pendingDescription: [], pendingProcessing: [], pendingModeration: [] });
		assert.ok(path.endsWith('/uploads')); assert.ok(init?.body instanceof File);
		const body = init.body;
		const original = originals.find(file => file.name === body.name); assert.ok(original);
		assert.equal(init.body.type, 'audio/wav'); assert.equal(init.body.lastModified, original.lastModified);
		assert.deepEqual(new Uint8Array(await init.body.arrayBuffer()), wav, 'each original and retry forwards every stereo PCM byte');
		uploaded.push(init.body.name);
		if (uploaded.length === 1 || firstStatus === 401 && !reconnected) return Response.json({
			error: { code: firstStatus === 401 ? 'not_authenticated' : 'unavailable', message: 'Upload failed.' },
		}, { status: firstStatus });
		return data({ uploadFilename: init.body.name });
	} });
	const session = createFreesoundPanelSession(client);
	await session.initialize();
	const ids = session.enqueueFiles(originals);
	await idle();
	assert.deepEqual(uploaded, firstStatus === 401 ? ['Take-1.wav'] : ['Take-1.wav', 'Take-2.wav', 'Take-3.wav']);
	assert.deepEqual(session.getSnapshot().uploadQueue.items.map(item => item.status), firstStatus === 401
		? ['failed', 'queued', 'queued'] : ['failed', 'ready-to-publish', 'ready-to-publish']);
	assert.equal(session.getSnapshot().auth.status, firstStatus === 401 ? 'disconnected' : 'connected');
	if (firstStatus === 401) { await session.connect(); await idle(); }
	assert.deepEqual(uploaded, ['Take-1.wav', 'Take-2.wav', 'Take-3.wav']);
	session.retry(ids[0]!); await idle();
	assert.deepEqual(uploaded, ['Take-1.wav', 'Take-2.wav', 'Take-3.wav', 'Take-1.wav']);
	assert.ok(session.getSnapshot().uploadQueue.items.every(item => item.status === 'ready-to-publish'));
	assert.ok(session.getSnapshot().uploadQueue.items.every(item => item.sourceKind === 'file'));
	for (const original of originals) assert.deepEqual(new Uint8Array(await original.arrayBuffer()), wav);
	async function idle() {
		for (let attempts = 0; session.getSnapshot().uploadQueue.active; attempts++) {
			assert.ok(attempts < 100, 'the upload pump must settle'); await setImmediate();
		}
	}
});

function data(value: unknown): Response { return Response.json({ data: value }); }
