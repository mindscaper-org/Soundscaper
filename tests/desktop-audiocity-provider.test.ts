/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAudiocomAuthorizationUrl } from '../desktop/audiocom-authorization.ts';
import { assertAudiocomLinkUrl } from '../desktop/audiocom-links.ts';
import { createDesktopAudiocomIntegration, createDesktopAudiocomProxy } from '../desktop/audiocom-integration.ts';

const APP_ORIGIN = 'soundscaper-app://bundle';
const BACKEND = 'http://127.0.0.1:8788';
const PROVIDER = { kind: 'audiocity', apiOrigin: 'http://127.0.0.1:8088', webOrigin: 'http://127.0.0.1:8088', scope: 'all' } as const;
const CONFIGURATION = { backendOrigin: BACKEND, provider: PROVIDER };
const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000002';
function authorize(origin: string = PROVIDER.apiOrigin, backend: string = BACKEND): string {
	const url = new URL('/auth/authorize', origin);
	for (const [key, value] of Object.entries({ client_id: 'client', response_type: 'code', state: 'opaque',
		redirect_uri: `${backend}/api/audiocom/oauth/callback`, scope: 'all',
		code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' })) url.searchParams.set(key, value);
	return url.href;
}

test('desktop Audiocity authorization requires trusted provider origins, its exact callback and combined scope', () => {
	const url = authorize();
	assert.equal(assertAudiocomAuthorizationUrl(url, CONFIGURATION), url);
	assert.throws(() => assertAudiocomAuthorizationUrl(url));
	for (const invalid of [
		authorize('http://127.0.0.1:8089'), authorize(PROVIDER.apiOrigin, 'http://127.0.0.1:8789'),
		url.replace('scope=all', 'scope=public'), `${url}&scope=all+projects`,
		url.replace('code_challenge_method=S256', 'code_challenge_method=plain'),
	]) assert.throws(() => assertAudiocomAuthorizationUrl(invalid, CONFIGURATION));
	assert.throws(() => assertAudiocomAuthorizationUrl(url, { ...CONFIGURATION, backendOrigin: 'https://soundscaper.org' }));
	assert.throws(() => assertAudiocomAuthorizationUrl(url, { ...CONFIGURATION, provider: { ...PROVIDER, apiOrigin: 'http://192.168.1.2:8088' } }));
	const remote = { backendOrigin: 'https://editor.example', provider: { ...PROVIDER, apiOrigin: 'https://audiocity.example', webOrigin: 'https://audiocity.example' } };
	const remoteUrl = authorize(remote.provider.apiOrigin, remote.backendOrigin);
	assert.equal(assertAudiocomAuthorizationUrl(remoteUrl, remote), remoteUrl);
});

test('desktop Audiocity links stay on configured provider pages and reject signed media and control endpoints', () => {
	for (const url of [`${PROVIDER.webOrigin}/`, `${PROVIDER.webOrigin}/recorder`,
		`${PROVIDER.webOrigin}/recorder/audio/field-take`, `${PROVIDER.webOrigin}/public/audio/${PROJECT_ID}`,
		`${PROVIDER.webOrigin}/audio/${PROJECT_ID}/play`]) {
		assert.equal(assertAudiocomLinkUrl(url, CONFIGURATION), url);
		assert.throws(() => assertAudiocomLinkUrl(url));
	}
	for (const url of [`${PROVIDER.webOrigin}/media/${PROJECT_ID}?signature=secret`, `${PROVIDER.webOrigin}/auth/token`,
		`${PROVIDER.webOrigin}/public/audio/${PROJECT_ID}?next=evil`, `${PROVIDER.webOrigin}/public/audio/%2e%2e`,
		`${PROVIDER.webOrigin}/audio/${PROJECT_ID}/play?token=secret`, `${PROVIDER.webOrigin}/audio/${PROJECT_ID}/edit`,
		`${PROVIDER.webOrigin}/audio/${PROJECT_ID}/play#fragment`, `${PROVIDER.webOrigin}/audio/not-an-id/play`,
		'http://127.0.0.1:8089/public/audio/id', `${PROVIDER.webOrigin}/recorder/audio/%2fescape`]) {
		assert.throws(() => assertAudiocomLinkUrl(url, CONFIGURATION));
	}
});

test('desktop resolves Audiocity configuration only from the main backend before opening custom URLs', async () => {
	const opened: string[] = [];
	const calls: string[] = [];
	const handlers = new Map<string, (event: unknown, value: unknown) => Promise<boolean>>();
	const integration = await createDesktopAudiocomIntegration({
		appOrigin: APP_ORIGIN, apiOrigin: BACKEND, productId: 'soundscaper', filePath: '/unused', platform: 'linux',
		channels: { openAudiocomAuthorization: 'authorize', openAudiocomLink: 'link' },
		safeStorage: { isEncryptionAvailable: () => false },
		handle: (channel, handler) => { handlers.set(channel, handler); },
		shell: { openExternal: async value => { opened.push(value); } },
		fetchImpl: async (url, init) => {
			calls.push(String(url));
			assert.equal(String(url), `${BACKEND}/api/audiocom/usage`);
			assert.equal(init?.redirect, 'error');
			assert.equal(new Headers(init?.headers).get('authorization'), null);
			return Response.json({ data: { provider: PROVIDER } });
		},
	});
	await assert.rejects(() => handlers.get('authorize')!(null, authorize()));
	assert.equal(calls.length, 0);
	const usage = new Request(`${APP_ORIGIN}/_desktop/audiocom/api/audiocom/usage`, { headers: { 'X-Audiocom-Api-Origin': PROVIDER.apiOrigin } });
	assert.equal((await integration.proxy!(usage)).status, 200);
	const openAuthorization = handlers.get('authorize')!;
	const openLink = handlers.get('link')!;
	await openAuthorization(null, authorize());
	await openLink(null, `${PROVIDER.webOrigin}/audio/${PROJECT_ID}/play`);
	assert.deepEqual(opened, [authorize(), `${PROVIDER.webOrigin}/audio/${PROJECT_ID}/play`]);
	assert.equal(calls.length, 1);
	await assert.rejects(() => openLink(null, 'http://127.0.0.1:8089/public/audio/id'));
	await assert.rejects(() => openAuthorization(null, { url: authorize(), provider: { ...PROVIDER, apiOrigin: 'https://evil.example' } }));
	assert.equal(opened.length, 2);
});

test('desktop rejects invalid backend provider discovery and keeps official URL checks independent of discovery', async () => {
	for (const provider of [
		{ ...PROVIDER, scope: 'admin' }, { ...PROVIDER, webOrigin: 'https://evil.example' },
		{ ...PROVIDER, authorizationOrigin: 'https://evil.example' },
		{ ...PROVIDER, apiOrigin: 'http://192.168.1.2:8088', webOrigin: 'http://192.168.1.2:8088' },
	]) {
		const opened: string[] = [];
		let discoveries = 0;
		const handlers = new Map<string, (event: unknown, value: unknown) => Promise<boolean>>();
		const integration = await createDesktopAudiocomIntegration({
			appOrigin: APP_ORIGIN, apiOrigin: BACKEND, productId: 'soundscaper', filePath: '/unused', platform: 'linux',
			channels: { openAudiocomAuthorization: 'authorize', openAudiocomLink: 'link' },
			safeStorage: { isEncryptionAvailable: () => false },
			handle: (channel, handler) => { handlers.set(channel, handler); },
			shell: { openExternal: async value => { opened.push(value); } },
			fetchImpl: async () => { discoveries++; return Response.json({ data: { provider } }); },
		});
		await handlers.get('link')!(null, 'https://audio.com/recorder/audio/field-take');
		assert.equal(discoveries, 0);
		const usage = new Request(`${APP_ORIGIN}/_desktop/audiocom/api/audiocom/usage`, { headers: { 'X-Audiocom-Api-Origin': PROVIDER.apiOrigin } });
		assert.equal((await integration.proxy!(usage)).status, 502);
		await assert.rejects(() => handlers.get('authorize')!(null, authorize()));
		await assert.rejects(() => handlers.get('link')!(null, `${PROVIDER.webOrigin}/public/audio/${PROJECT_ID}`));
		assert.equal(discoveries, 1);
		assert.deepEqual(opened, ['https://audio.com/recorder/audio/field-take']);
	}
});

test('desktop proxies Audacity manifests, native parts, completion and cancellation using one backend route', async () => {
	const calls: { url: URL; headers: Headers; body: string }[] = [];
	const proxy = createDesktopAudiocomProxy({ appOrigin: APP_ORIGIN, apiOrigin: BACKEND,
		sessionStore: { get: () => 'a'.repeat(43), set: async () => {}, clear: async () => {} },
		fetchImpl: async (input, init) => { calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers), body: await new Response(init?.body).text() }); return Response.json({ data: {} }); },
	});
	const request = (query: string, init: RequestInit) => new Request(`${APP_ORIGIN}/_desktop/audiocom/api/audiocom/projects?${query}`, init);
	const manifest = JSON.stringify({ name: 'Session', blocks: [], id: '123', head: SNAPSHOT_ID });
	assert.equal((await proxy(request('phase=prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: manifest }))).status, 200);
	const query = `project=123&snapshot=${SNAPSHOT_ID}`;
	const bytes = new Uint8Array([1, 2, 3, 4]);
	assert.equal((await proxy(request(`phase=part&${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Audiocom-Content-Length': '4', 'X-Audiocom-Filename': 'snapshot.xml' }, body: bytes }))).status, 200);
	assert.equal((await proxy(request(`phase=complete&${query}`, { method: 'POST' }))).status, 200);
	assert.equal((await proxy(request(query, { method: 'DELETE' }))).status, 200);
	assert.equal(calls[0]?.body, manifest); assert.equal(calls[1]?.headers.get('Content-Length'), '4');
	assert(calls.every(call => call.url.origin === BACKEND && call.url.pathname === '/api/audiocom/projects'));
	assert.equal((await proxy(request(`phase=part&${query}&force=true`, { method: 'POST' }))).status, 400);
	assert.equal((await proxy(new Request(`${APP_ORIGIN}/_desktop/audiocom/api/audiocom/projects/prepare`, { method: 'POST' }))).status, 404);
	assert.equal((await proxy(new Request(`${APP_ORIGIN}/_desktop/audiocom/api/audiocom/projects/download`))).status, 404);
	assert.equal(calls.length, 4);
});

test('desktop forwards validated provider selections only to its fixed backend and leaves preview selection to the pinned grant', async () => {
	const calls: { url: string; origin: string | null }[] = [];
	const proxy = createDesktopAudiocomProxy({ appOrigin: APP_ORIGIN, apiOrigin: BACKEND,
		sessionStore: { get: () => null, set: async () => {}, clear: async () => {} },
		fetchImpl: async (input, init) => {
			calls.push({ url: String(input), origin: new Headers(init?.headers).get('X-Audiocom-Api-Origin') });
			return Response.json({ data: { connected: false } });
		},
	});
	const request = (origin: string) => new Request(`${APP_ORIGIN}/_desktop/audiocom/api/audiocom/oauth/session`, { headers: { 'X-Audiocom-Api-Origin': origin } });
	for (const origin of ['https://api.audio.com', 'https://audio.example.org', PROVIDER.apiOrigin]) assert.equal((await proxy(request(origin))).status, 200);
	assert(calls.every(call => call.url === `${BACKEND}/api/audiocom/oauth/session`));
	assert.deepEqual(calls.map(call => call.origin), ['https://api.audio.com', 'https://audio.example.org', PROVIDER.apiOrigin]);
	for (const origin of ['https://user:password@evil.example', 'https://evil.example/path', 'http://evil.example', 'https://evil.example?x=1']) assert.equal((await proxy(request(origin))).status, 400);
	assert.equal(calls.length, 3);
	await proxy(new Request(`${APP_ORIGIN}/_desktop/audiocom/api/audiocom/preview?url=opaque`));
	assert.equal(calls.at(-1)?.origin, null);
});

test('desktop never trusts mismatched provider metadata or an abandoned selection when opening authorization', async () => {
	const handlers = new Map<string, (event: unknown, value: unknown) => Promise<boolean>>();
	const opened: string[] = []; let mismatch = true;
	const integration = await createDesktopAudiocomIntegration({
		appOrigin: APP_ORIGIN, apiOrigin: BACKEND, productId: 'soundscaper', filePath: '/unused', platform: 'linux',
		channels: { openAudiocomAuthorization: 'authorize', openAudiocomLink: 'link' }, safeStorage: { isEncryptionAvailable: () => false },
		handle: (channel, handler) => { handlers.set(channel, handler); }, shell: { openExternal: async value => { opened.push(value); } },
		fetchImpl: async () => Response.json({ data: { provider: mismatch ? { ...PROVIDER, apiOrigin: 'https://other.example.org', webOrigin: 'https://other.example.org' } : PROVIDER } }),
	});
	const usage = () => new Request(`${APP_ORIGIN}/_desktop/audiocom/api/audiocom/usage`, { headers: { 'X-Audiocom-Api-Origin': PROVIDER.apiOrigin } });
	assert.equal((await integration.proxy!(usage())).status, 502);
	await assert.rejects(() => handlers.get('authorize')!(null, authorize()));
	mismatch = false; assert.equal((await integration.proxy!(usage())).status, 200);
	await handlers.get('authorize')!(null, authorize()); assert.deepEqual(opened, [authorize()]);
	mismatch = true; assert.equal((await integration.proxy!(usage())).status, 502);
	await assert.rejects(() => handlers.get('authorize')!(null, authorize()));
});
