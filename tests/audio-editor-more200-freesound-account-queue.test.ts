/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createFreesoundApiClient } from '../src/common/editor/ui/workspace/freesound-auth-upload-client.ts';
import { createFreesoundPanelSession } from '../src/common/editor/ui/workspace/freesound-panel-session.ts';
import { encodeWav } from '../src/common/editor/wav.js';

for (const incoming of [
	{ id: 2, username: 'new-account', changed: true },
	{ id: 1, username: 'original-account', changed: false },
	{ id: 1, username: 'renamed-account', changed: false },
	{ username: 'original-account', changed: false },
]) test(`Freesound pending uploads follow account ${JSON.stringify(incoming)}`, async () => {
	let reconnected = false;
	const client = createFreesoundApiClient({ openAuthorization() {}, request: async path => {
		if (path.endsWith('/oauth/session')) return data({ connected: true, user: { id: 1, username: 'original-account' } });
		if (path.endsWith('/oauth/poll')) { reconnected = true; return data({ connected: true, user: incoming }); }
		if (path.endsWith('/oauth/start')) return data({ attemptId: 'retry', handoffToken: 'retry-handoff',
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=ordinary&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback&response_type=code&state=retry' });
		if (path.endsWith('/uploads/pending')) return data({
			pendingDescription: [reconnected && incoming.changed ? 'new-account.wav' : 'original-account.wav'],
			pendingProcessing: [], pendingModeration: [],
		});
		assert.ok(path.endsWith('/uploads'));
		return Response.json({ error: { code: 'not_authenticated', message: 'Login expired.' } }, { status: 401 });
	} });
	const session = createFreesoundPanelSession(client);
	await session.initialize();
	assert.deepEqual(session.getSnapshot().uploadQueue.items.map(item => item.fileName), ['original-account.wav']);
	const wav = Uint8Array.from(encodeWav([new Float32Array(48).fill(.25)], { sampleRate: 48_000 }));
	session.enqueueFiles([new File([wav], 'Original local.wav', { type: 'audio/wav' })]);
	for (let attempts = 0; session.getSnapshot().uploadQueue.active; attempts++) {
		assert.ok(attempts < 100); await setImmediate();
	}
	assert.equal(session.getSnapshot().auth.status, 'disconnected');
	await session.connect();
	assert.equal(session.getSnapshot().auth.user?.username, incoming.username);
	assert.deepEqual(session.getSnapshot().uploadQueue.items.map(item => item.fileName), incoming.changed
		? ['new-account.wav'] : ['original-account.wav', 'Original local.wav']);
});

function data(value: unknown): Response { return Response.json({ data: value }); }

test('a late account A publication cannot restore its row after account B connects', async () => {
	let reconnected = false;
	let release!: (response: Response) => void;
	const description = new Promise<Response>(resolve => { release = resolve; });
	let signal: AbortSignal | null | undefined;
	const client = createFreesoundApiClient({ openAuthorization() {}, request: async (path, init) => {
		if (path.endsWith('/oauth/session')) return data({ connected: true, user: { id: 1, username: 'original-account' } });
		if (path.endsWith('/oauth/poll')) { reconnected = true; return data({ connected: true, user: { id: 2, username: 'new-account' } }); }
		if (path.endsWith('/oauth/start')) return data({ attemptId: 'retry', handoffToken: 'retry-handoff',
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=ordinary&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback&response_type=code&state=retry' });
		if (path.endsWith('/uploads/pending')) return data({
			pendingDescription: [reconnected ? 'new-account.wav' : 'original-account.wav'], pendingProcessing: [], pendingModeration: [],
		});
		assert.ok(path.endsWith('/uploads/describe')); signal = init?.signal; return description;
	} });
	const session = createFreesoundPanelSession(client);
	await session.initialize();
	const original = session.getSnapshot().uploadQueue.items[0]; assert.ok(original);
	const publishing = session.publish(original.id, { title: 'Rain', description: 'A rain recording.',
		tags: ['rain', 'field', 'ambience'], categoryId: 'ss-n', license: 'cc-by', rightsConfirmed: true });
	const outcome = publishing.then(() => null, (error: unknown) => error);
	try {
		await setImmediate(); assert.ok(signal);
		session.expireAuthentication(); await session.connect();
		assert.equal(signal.aborted, true);
		release(data({ soundId: 42, status: 'pending_moderation' })); await outcome;
		assert.equal(session.getSnapshot().auth.user?.username, 'new-account');
		assert.deepEqual(session.getSnapshot().uploadQueue.items.map(item => item.fileName), ['new-account.wav']);
	} finally { release(data({ soundId: 42, status: 'pending_moderation' })); await outcome; }
});
