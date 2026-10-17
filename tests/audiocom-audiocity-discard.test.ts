/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAudiocomUploadRequest } from '../functions/api/audiocom/_shared/handlers.ts';
import { handleAudiocomOAuthStartRequest, handleAudiocomOAuthCallbackRequest, handleAudiocomOAuthPollRequest } from '../functions/api/audiocom/_shared/oauth-handlers.ts';
import type { AudiocomOAuthEnv, AudiocomOAuthFunctionContext } from '../functions/api/audiocom/_shared/oauth-http.ts';
import { MemoryAudiocomOAuthRepository } from './helpers/audiocom-oauth-memory-repository.ts';

const NOW = Date.UTC(2026, 9, 17);
const EDITOR = 'http://127.0.0.1:4322';
const PROVIDER = 'http://127.0.0.1:8088';
const AUDIO_ID = '34c792f3-f4bb-44e8-8b0a-314210b4d933';
const BLOB_ID = '2a61578f-044c-4645-b174-10fd0eece42c';
const TOKEN = 't'.repeat(43);
const QUERY = `token=${TOKEN}&X-Amz-Date=20261017T000000Z&X-Amz-Expires=86400`;
const audio = { id: AUDIO_ID, title: 'Recording', username: 'owner', slug: 'recording', author_name: 'Owner',
	description: '', license: 'arr', is_downloadable: false, play: { duration: 0, url: '' } };

async function connected(official = false) {
	const env: AudiocomOAuthEnv = { AUDIOCOM_LOCAL_DEVELOPMENT: '1', AUDIOCOM_CLIENT_ID: 'registered-client',
		AUDIOCOM_OAUTH_MASTER_KEY: `v1:${Buffer.alloc(32, 11).toString('base64url')}`,
		...(!official ? { AUDIOCOM_PROVIDER: 'audiocity', AUDIOCOM_API_ORIGIN: PROVIDER } : {}) };
	const context = (request: Request): AudiocomOAuthFunctionContext => ({ request, env, params: {} });
	const post = (path: string, body: unknown) => new Request(`${EDITOR}/api/audiocom/${path}`, {
		method: 'POST', headers: { Origin: 'soundscaper-app://bundle', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
	});
	const repository = new MemoryAudiocomOAuthRepository();
	const started = await handleAudiocomOAuthStartRequest(context(post('oauth/start', { client: 'desktop' })), { repository, now: () => NOW });
	assert.equal(started.status, 201);
	const { data: attempt } = await started.json() as { data: { attemptId: string; handoffToken: string; authorizeUrl: string } };
	const state = new URL(attempt.authorizeUrl).searchParams.get('state') ?? '';
	const callback = await handleAudiocomOAuthCallbackRequest(context(new Request(`${EDITOR}/api/audiocom/oauth/callback?code=code&state=${state}`)), {
		repository, now: () => NOW, fetchImpl: async () => Response.json({ token_type: 'Bearer', expires_in: 3600,
			access_token: 'private-access', refresh_token: 'private-refresh', scope: official ? 'public' : 'public projects' }),
	});
	assert.equal(callback.status, 200);
	const poll = await handleAudiocomOAuthPollRequest(context(post('oauth/poll', { attemptId: attempt.attemptId, handoffToken: attempt.handoffToken })), { repository, now: () => NOW });
	assert.equal(poll.status, 200);
	const { data } = await poll.json() as { data: { sessionToken: string } };
	return { repository, context, request: (signal?: AbortSignal) => new Request(`${EDITOR}/api/audiocom/uploads?title=Recording&category=recording`, {
		method: 'POST', headers: { Origin: 'soundscaper-app://bundle', Authorization: `Bearer ${data.sessionToken}`,
			'Content-Type': 'audio/flac', 'X-Audiocom-Filename': 'recording.flac', 'X-Audiocom-Content-Length': '4' },
		body: new Uint8Array([1, 2, 3, 4]), ...(signal ? { signal } : {}),
	}) };
}

for (const failure of ['put', 'expired-capability', 'lost-confirmation', 'aborted-confirmation', 'aborted-metadata']) {
	test(`Audiocity ${failure} cleanup deletes the exact owned recording with independent cleanup requests`, async () => {
		const f = await connected();
		const controller = new AbortController();
		const request = f.request(controller.signal);
		let metadataPresent = true; let ready = false;
		const calls: string[] = [];
		const response = await handleAudiocomUploadRequest(f.context(request), {
			repository: f.repository, now: () => NOW, fetchImpl: async (input, init) => {
				const url = new URL(String(input));
				assert.equal(url.origin, PROVIDER);
				calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
				if (url.pathname === '/v1/audio/create') return Response.json({ audio,
					url: `${PROVIDER}/uploads/${BLOB_ID}?${QUERY}`, success: `${PROVIDER}/uploads/${BLOB_ID}/success?${QUERY}`,
					fail: `${PROVIDER}/uploads/${BLOB_ID}/fail?${QUERY}`, extra: { token: 'untrusted-extra-token' } }, { status: 201 });
				if (url.pathname === '/v1/audio/view') {
					assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-access');
					controller.abort();
					throw new Error('Metadata refresh was cancelled.');
				}
				if (url.pathname === '/v1/audio/delete') {
					assert.equal(init?.method, 'POST');
					assert.equal(init.redirect, 'manual');
					assert.ok(init.signal instanceof AbortSignal);
					assert.notEqual(init.signal, request.signal);
					assert.equal(init.signal.aborted, false);
					assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer private-access');
					assert.equal(new Headers(init.headers).has('Cookie'), false);
					assert.equal(url.searchParams.size, 1);
					assert.equal(url.searchParams.get('id'), AUDIO_ID, 'delete uses the recording ID, not its upload blob ID');
					metadataPresent = false; ready = false;
					return new Response(null, { status: 204 });
				}
				assert.equal(new Headers(init?.headers).has('Authorization'), false);
				assert.equal(new Headers(init?.headers).has('Cookie'), false);
				if (init?.method === 'PUT') {
					assert.ok(init.body instanceof ReadableStream);
					await new Response(init.body).arrayBuffer();
					return new Response(null, { status: failure === 'put' ? 503 : failure === 'expired-capability' ? 403 : 204 });
				}
				if (url.pathname.endsWith('/success')) {
					ready = true;
					if (failure === 'aborted-confirmation') controller.abort();
					if (failure !== 'aborted-metadata') throw new Error('The confirmation response was lost.');
					return new Response(null, { status: 204 });
				}
				assert.equal(init?.method, 'DELETE');
				assert.equal(init.redirect, 'manual');
				assert.ok(init.signal instanceof AbortSignal);
				assert.notEqual(init.signal, request.signal);
				assert.equal(init.signal.aborted, false);
				assert.equal(url.pathname, `/uploads/${BLOB_ID}/fail`);
				assert.equal(url.searchParams.get('token'), TOKEN);
				return new Response(null, { status: failure === 'expired-capability' ? 403 : ready ? 409 : 200 });
			},
		});
		assert.equal(response.status, 502, await response.clone().text());
		assert.equal(metadataPresent, false, 'failed or cancelled uploads must not leave a recording behind');
		assert.equal(ready, false);
		assert.deepEqual(calls.slice(-2), [`DELETE /uploads/${BLOB_ID}/fail`, 'POST /v1/audio/delete']);
	});
}

test('invalid Audiocity recording IDs or transfer destinations cannot trigger upload or discard requests', async () => {
	for (const fields of [
		{ audio: { ...audio, id: '../another-recording' } },
		{ url: `https://untrusted.example/uploads/${BLOB_ID}?${QUERY}` },
		{ url: `${PROVIDER}/uploads/${BLOB_ID}?${QUERY}&token=${TOKEN}` },
		{ fail: `https://untrusted.example/uploads/${BLOB_ID}/fail?${QUERY}` },
	]) {
		const f = await connected(); let calls = 0;
		const response = await handleAudiocomUploadRequest(f.context(f.request()), {
			repository: f.repository, now: () => NOW, fetchImpl: async (input) => {
				calls++;
				assert.equal(String(input), `${PROVIDER}/v1/audio/create`);
				return Response.json({ audio, url: `${PROVIDER}/uploads/${BLOB_ID}?${QUERY}`,
					success: `${PROVIDER}/uploads/${BLOB_ID}/success?${QUERY}`, fail: `${PROVIDER}/uploads/${BLOB_ID}/fail?${QUERY}`, ...fields }, { status: 201 });
			},
		});
		assert.equal(response.status, 502);
		assert.equal(calls, 1);
	}
});

test('official audio.com upload failure keeps its existing signed failure hook behavior', async () => {
	const f = await connected(true);
	const calls: string[] = [];
	const fail = 'https://api.audio.com/audio/fail?id=123';
	const response = await handleAudiocomUploadRequest(f.context(f.request()), {
		repository: f.repository, now: () => NOW, fetchImpl: async (input, init) => {
			const url = new URL(String(input));
			calls.push(`${init?.method ?? 'GET'} ${url.href}`);
			if (url.pathname === '/v1/audio/create') return Response.json({ audio: { ...audio, id: '123' },
				url: 'https://s3.eu-central-1.wasabisys.com/audio.com.audio/source/file.flac',
				success: 'https://api.audio.com/audio/success?id=123', fail }, { status: 201 });
			assert.equal(new Headers(init?.headers).has('Authorization'), false);
			if (init?.method === 'PUT') {
				assert.ok(init.body instanceof ReadableStream);
				await new Response(init.body).arrayBuffer();
				return new Response(null, { status: 503 });
			}
			assert.equal(String(input), fail);
			return new Response(null, { status: 204 });
		},
	});
	assert.equal(response.status, 502);
	assert.equal(calls.length, 3);
	assert.equal(calls[2], `DELETE ${fail}`);
});
