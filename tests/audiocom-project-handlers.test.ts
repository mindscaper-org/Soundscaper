/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAudiocomProjectsRequest } from '../functions/api/audiocom/_shared/project-handlers.ts';
import { encryptOAuthSecret, hashCapability } from '../functions/api/audiocom/_shared/oauth-crypto.ts';
import { encodeBase64Url } from '../functions/api/freesound/_shared/oauth-crypto.ts';
import type { AudiocomOAuthFunctionContext } from '../functions/api/audiocom/_shared/oauth-http.ts';
import { MemoryAudiocomOAuthRepository } from './helpers/audiocom-oauth-memory-repository.ts';

const NOW = Date.UTC(2026, 9, 15), TOKEN = 't'.repeat(43), GRANT = 'audiocom-user-attempt';
const KEY = `v1:${encodeBase64Url(new Uint8Array(32).fill(13))}`;
const SNAPSHOT = '87654321-1234-4234-8234-123456789abc';
const OLD = 'aaaaaaaa-1234-4234-8234-123456789abc';
const UPLOAD = '12345678-1234-4234-8234-123456789abc';
const HASH = '00000001' + 'A'.repeat(56);

for (const origin of ['https://api.audio.com', 'http://127.0.0.1:8088']) {
	const project = { id: 123, name: 'Session', size: 32, head: { id: SNAPSHOT }, latest_synced_snapshot_id: OLD };
	const descriptor = origin === 'https://api.audio.com' ? {
		url: `https://s3.eu-central-1.wasabisys.com/audio.com.projects/projects/123/${SNAPSHOT}/snapshot.xml?X-Amz-Signature=signature`,
		success: `${origin}/project/123/snapshot/${SNAPSHOT}/file/success?token=secret`,
		fail: `${origin}/project/123/snapshot/${SNAPSHOT}/file/fail?token=secret`,
	} : {
		url: `${origin}/uploads/${UPLOAD}?token=${TOKEN}`,
		success: `${origin}/uploads/${UPLOAD}/success?token=${TOKEN}`,
		fail: `${origin}/uploads/${UPLOAD}/fail?token=${TOKEN}`,
	};
	const context = (query: string, init: RequestInit = {}): AudiocomOAuthFunctionContext => ({
		request: new Request(`http://127.0.0.1:4321/api/audiocom/projects${query}`, { ...init, headers: {
			Origin: 'http://127.0.0.1:4321', Authorization: `Bearer ${TOKEN}`, 'X-Audiocom-Api-Origin': origin, ...init.headers,
		} }), env: { AUDIOCOM_OAUTH_MASTER_KEY: KEY, AUDIOCOM_LOCAL_DEVELOPMENT: '1' }, params: {},
	});
	async function session() {
		const repository = new MemoryAudiocomOAuthRepository();
		repository.grants.set(GRANT, { id: GRANT, user: { id: origin === 'https://api.audio.com' ? 'audiocom-attempt' : `audiocity-${await hashCapability(origin)}-attempt`, username: '' },
			provider: { apiOrigin: origin, clientId: 'soundscaper', redirectUri: 'http://127.0.0.1:4321/api/audiocom/oauth/callback', scope: 'all' },
			accessTokenCiphertext: await encryptOAuthSecret('provider-secret', KEY, `audiocom-oauth:${GRANT}:access`),
			refreshTokenCiphertext: await encryptOAuthSecret('provider-refresh', KEY, `audiocom-oauth:${GRANT}:refresh`),
			accessExpiresAt: NOW + 3600_000, refreshGeneration: 0, refreshLeaseOwner: null, refreshLeaseExpiresAt: null });
		const tokenHash = await hashCapability(TOKEN);
		repository.sessions.set(tokenHash, { tokenHash, grantId: GRANT, clientKind: 'desktop', createdAt: NOW, expiresAt: NOW + 86_400_000 });
		return repository;
	}
	test(`${origin}: Audacity manifest prepares a revision without format, size, force or signed URL disclosure`, async () => {
		const repository = await session(); const calls: string[] = [];
		const response = await handleAudiocomProjectsRequest(context('?phase=prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Session', blocks: [HASH], id: '123', head: OLD }) }), { repository, now: () => NOW,
			fetchImpl: async (input, init) => {
				const url = new URL(String(input)); calls.push(url.pathname);
				assert.equal(url.origin, origin); assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer provider-secret');
				if (init?.method !== 'POST') return Response.json({ ...project, head: { id: OLD } });
				assert.deepEqual(JSON.parse(String(init.body)), { name: 'Session', blocks: [HASH], head_snapshot_id: OLD });
				return Response.json({ project, snapshot: { id: SNAPSHOT }, sync: { file: descriptor, blocks: [{ ...descriptor, id: HASH.toLowerCase() }] } });
			} });
		assert.equal(response.status, 201, await response.clone().text());
		assert.deepEqual(await response.json(), { data: { projectId: '123', snapshotId: SNAPSHOT, missing: [HASH.toLowerCase()] } });
		assert.deepEqual(calls, ['/project/123', '/project/123/snapshot']);
	});
	test(`${origin}: a stale head never forces a revision or transfers bytes`, async () => {
		const repository = await session(); let calls = 0;
		const response = await handleAudiocomProjectsRequest(context('?phase=prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Session', blocks: [], id: '123', head: OLD }) }), { repository, now: () => NOW,
			fetchImpl: async (_input, init) => { calls++; assert.equal(init?.method, undefined); return Response.json(project); } });
		assert.equal(response.status, 409); assert.equal(calls, 1);
	});
	test(`${origin}: native metadata and blocks stream only to validated signed storage without OAuth`, async () => {
		for (const block of [false, true]) {
			const repository = await session(); let transferred = false; let confirmed = false;
			const bytes = Uint8Array.of(1, 2, 3, 4);
			const response = await handleAudiocomProjectsRequest(context(`?phase=part&project=123&snapshot=${SNAPSHOT}${block ? `&hash=${HASH.toLowerCase()}` : ''}`, {
				method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream', 'X-Audiocom-Content-Length': String(bytes.length) },
			}), { repository, now: () => NOW, fetchImpl: async (input, init) => {
				const url = new URL(String(input));
				if (url.href === descriptor.url) {
					assert.equal(init?.method, 'PUT'); assert.equal(new Headers(init.headers).has('Authorization'), false);
					assert.deepEqual(new Uint8Array(await new Response(init.body).arrayBuffer()), bytes); transferred = true;
					return new Response(null, { status: 200 });
				}
				if (url.href === descriptor.success) { confirmed = true; assert.equal(new Headers(init?.headers).has('Authorization'), false); return new Response(null, { status: 204 }); }
				if (url.pathname.endsWith('/sync')) return Response.json({ file: descriptor, blocks: [{ ...descriptor, id: HASH }] });
				return Response.json(url.pathname.endsWith(SNAPSHOT) ? { id: SNAPSHOT, date_synced: 0 } : project);
			} });
			assert.equal(response.status, 204, await response.clone().text()); assert.equal(transferred && confirmed, true);
		}
	});
	test(`${origin}: completion advances the head and a completed snapshot cannot be cancelled`, async () => {
		const repository = await session(); let completed = false; let deleted = false;
		const dependencies = { repository, now: () => NOW, fetchImpl: (async (input, init) => {
			const url = new URL(String(input));
			if (init?.method === 'DELETE') deleted = true;
			if (url.pathname.endsWith('/sync')) { completed = true; return new Response(null, { status: 204 }); }
			return Response.json(url.pathname.endsWith(SNAPSHOT) ? { date_synced: completed ? 123 : 0 } : { ...project, latest_synced_snapshot_id: completed ? SNAPSHOT : OLD });
		}) as typeof fetch };
		const response = await handleAudiocomProjectsRequest(context(`?phase=complete&project=123&snapshot=${SNAPSHOT}`, { method: 'POST' }), dependencies);
		assert.equal(response.status, 201, await response.clone().text());
		assert.equal((await response.json() as { data: { snapshotId: string } }).data.snapshotId, SNAPSHOT);
		const cancelled = await handleAudiocomProjectsRequest(context(`?project=123&snapshot=${SNAPSHOT}`, { method: 'DELETE' }), dependencies);
		assert.equal(cancelled.status, 409); assert.equal(deleted, false);
	});
	test(`${origin}: older public-only connections require consent before any project request`, async () => {
		const repository = await session(); const grant = repository.grants.get(GRANT)!;
		repository.grants.set(GRANT, { ...grant, provider: { ...grant.provider!, scope: 'public' } });
		let calls = 0;
		const response = await handleAudiocomProjectsRequest(context('?page=1'), { repository, now: () => NOW, fetchImpl: async () => { calls++; return Response.json({}); } });
		assert.equal(response.status, 403); assert.match(await response.text(), /Reconnect/u); assert.equal(calls, 0);
	});

	test(`${origin}: native project listing uses the same standard endpoint and accepts numeric project IDs`, async () => {
		const repository = await session();
		const response = await handleAudiocomProjectsRequest(context('?page=1'), { repository, now: () => NOW, fetchImpl: async input => {
			const url = new URL(String(input)); assert.equal(url.pathname, '/project'); assert.equal(url.searchParams.has('transport'), false);
			return Response.json({ items: [project], pagination: { page: 1, pages: 1 } });
		} });
		assert.equal(response.status, 200); assert.match(await response.text(), /"id":"123"/u);
	});
}

test('native transfer admission rejects foreign storage, wrong buckets and another snapshot’s hooks', async () => {
	const { nativeTransferUrls } = await import('../functions/api/audiocom/_shared/project-contracts.ts');
	const { DEFAULT_AUDIOCOM_PROVIDER } = await import('../functions/api/audiocom/_shared/provider-config.ts');
	const descriptor = { url: 'https://s3.eu-central-1.wasabisys.com/audio.com.projects/projects/123/snapshot.xml?X-Amz-Signature=signed',
		success: `https://api.audio.com/project/123/snapshot/${SNAPSHOT}/file/success?token=signed`,
		fail: `https://api.audio.com/project/123/snapshot/${SNAPSHOT}/file/fail?token=signed` };
	assert.doesNotThrow(() => nativeTransferUrls(descriptor, DEFAULT_AUDIOCOM_PROVIDER, '123', SNAPSHOT));
	for (const changed of [
		{ url: descriptor.url.replace('s3.eu-central-1.wasabisys.com', 'evil.example') },
		{ url: descriptor.url.replace('audio.com.projects', 'audio.com.audio') },
		{ url: descriptor.url.replace('?X-Amz-Signature=signed', '') },
		{ success: descriptor.success.replace(SNAPSHOT, OLD) },
		{ fail: descriptor.fail.replace('api.audio.com', 'evil.example') },
		{ url: descriptor.url.replace('https://', 'https://user:password@') },
	]) assert.throws(() => nativeTransferUrls({ ...descriptor, ...changed }, DEFAULT_AUDIOCOM_PROVIDER, '123', SNAPSHOT));
});
