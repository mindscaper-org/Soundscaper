/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudiocomProjectArchives, type AudiocomProjectArchiveClient } from '../src/common/editor/controller/import/audiocom-project-archives.ts';
import { createAudiocomProjectArchiveClient } from '../src/common/editor/controller/import/internal/audiocom-project-archive-client.ts';
import { AudiocomApiError } from '../src/common/editor/controller/import/internal/audiocom-api-client.ts';

const ID = '12345678-1234-4234-8234-123456789abc';
const item = { id: ID, name: 'Session', format: 'aup3' as const, size: 32, snapshotId: ID };
const client = (overrides: Partial<AudiocomProjectArchiveClient> = {}): AudiocomProjectArchiveClient => ({
	capabilities: () => Promise.resolve({ formats: ['aup3', 'aup4'], maximumBytes: 100000000 }),
	list: page => Promise.resolve({ results: [item], page, hasNext: false }),
	upload: () => Promise.resolve(item), ...overrides,
});

test('project archives remain hidden until advertised and reset on account disconnection', async () => {
	const session = createAudiocomProjectArchives({ client: client() });
	assert.equal(session.getSnapshot().supported, false);
	await session.setConnected(true); assert.equal(session.getSnapshot().supported, true);
	await session.refresh(1); assert.deepEqual(session.getSnapshot().results, [item]);
	await session.setConnected(false); assert.equal(session.getSnapshot().supported, false);
	assert.deepEqual(session.getSnapshot().results, []); session.dispose(); session.dispose();
});

test('account changes fence an old archive list and abort the request', async () => {
	let resolve: (value: Awaited<ReturnType<AudiocomProjectArchiveClient['list']>>) => void = () => {};
	let signal: AbortSignal | undefined;
	const session = createAudiocomProjectArchives({ client: client({ list: (_page, selected) => {
		signal = selected; return new Promise(done => { resolve = done; });
	} }) });
	await session.setConnected(true); const pending = session.refresh(1);
	await session.setConnected(false); resolve({ results: [item], page: 1, hasNext: false }); await pending;
	assert.equal(signal?.aborted, true); assert.deepEqual(session.getSnapshot().results, []); session.dispose();
});

test('archive authentication expiry clears private results and resets the shared account exactly once', async () => {
	let expired = false; let accountResets = 0;
	const session = createAudiocomProjectArchives({ client: client({ list: page => expired
		? Promise.reject(new AudiocomApiError(401, 'Reconnect to continue.')) : Promise.resolve({ results: [item], page, hasNext: false }) }),
		onAuthenticationExpired: () => { accountResets += 1; } });
	await session.setConnected(true); await session.refresh(1); assert.equal(session.getSnapshot().results.length, 1);
	expired = true; await session.refresh(1); await session.refresh(1);
	assert.equal(accountResets, 1); assert.deepEqual(session.getSnapshot().results, []);
	assert.equal(session.getSnapshot().supported, false); session.dispose();
});

test('archive authentication errors retain their status for incomplete or non-JSON error bodies', async () => {
	for (const response of [new Response('<html>Sign in</html>', { status: 401 }), Response.json({ message: 'Sign in' }, { status: 401 }), new Response(null, { status: 401 })]) {
		const api = createAudiocomProjectArchiveClient({ fetch: () => Promise.resolve(response) });
		await assert.rejects(api.list(1), error => error instanceof AudiocomApiError && error.status === 401);
	}
});

test('archive provider metadata applies the same editor-origin policy as OAuth', async () => {
	const provider = { kind: 'audiocity', apiOrigin: 'http://127.0.0.1:8088', webOrigin: 'http://127.0.0.1:8088', scope: 'all' };
	const metadata = () => Promise.resolve(Response.json({ data: { provider, projectStorageSupported: true, projectFormats: ['aup3'], maximumUploadBytes: 100000000 } }));
	const local = createAudiocomProjectArchiveClient({ apiOrigin: provider.apiOrigin, location: { origin: 'http://127.0.0.1:4321', protocol: 'http:' }, fetch: metadata });
	assert.equal((await local.capabilities()).provider?.webOrigin, provider.webOrigin);
	const remote = createAudiocomProjectArchiveClient({ location: { origin: 'https://soundscaper.org', protocol: 'https:' }, fetch: metadata });
	await assert.rejects(remote.capabilities(), /origin/iu);
});
