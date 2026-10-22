/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTokenPair } from '../functions/api/audiocom/_shared/oauth-contracts.ts';
import { normalizeAudio } from '../functions/api/audiocom/_shared/contracts.ts';
import { providerConfiguration, trustedProviderHookUrl, trustedProviderMediaUrl, trustedProviderUploadUrl } from '../functions/api/audiocom/_shared/provider-config.ts';

const origin = 'http://127.0.0.1:8088';
const localEnv = { AUDIOCOM_PROVIDER: 'audiocity', AUDIOCOM_API_ORIGIN: origin, AUDIOCOM_LOCAL_DEVELOPMENT: '1' };
const id = '34c792f3-f4bb-44e8-8b0a-314210b4d933';
const token = 'a'.repeat(43);

test('audio.com remains the fixed default; custom origins require explicit Audiocity configuration', () => {
	assert.deepEqual(providerConfiguration({}), { kind: 'audiocom', apiOrigin: 'https://api.audio.com', webOrigin: 'https://audio.com', authorizationOrigin: 'https://api.audio.com', scope: 'all' });
	for (const env of [{ AUDIOCOM_API_ORIGIN: origin }, { AUDIOCOM_PROVIDER: 'unknown' }, { AUDIOCOM_PROVIDER: 'audiocity' }, { AUDIOCOM_PROVIDER: 'audiocity', AUDIOCOM_API_ORIGIN: origin }]) {
		assert.throws(() => providerConfiguration(env));
	}
});
test('Audiocity accepts exactly configured HTTPS or explicitly enabled HTTP loopback origins', () => {
	assert.equal(providerConfiguration(localEnv).apiOrigin, origin);
	assert.equal(providerConfiguration({ AUDIOCOM_PROVIDER: 'audiocity', AUDIOCOM_API_ORIGIN: 'https://audio.example:8443' }).webOrigin, 'https://audio.example:8443');
	for (const value of ['http://audio.example', 'http://192.168.1.2:8088', `${origin}/private`, `${origin}?key=secret`, `${origin}#fragment`, 'http://name:secret@127.0.0.1:8088']) {
		assert.throws(() => providerConfiguration({ ...localEnv, AUDIOCOM_API_ORIGIN: value }));
	}
});
test('Audiocity signed destinations pin the origin, transfer path, capability shape and hook method', () => {
	const provider = providerConfiguration(localEnv);
	assert.equal(trustedProviderUploadUrl(`${origin}/uploads/${id}?token=${token}`, provider).origin, origin);
	assert.equal(trustedProviderMediaUrl(`${origin}/media/${id}?expires=1792080000&signature=${token}`, provider).origin, origin);
	assert.equal(trustedProviderHookUrl(`${origin}/uploads/${id}/success?token=${token}`, provider, 'success').origin, origin);
	for (const value of [`http://localhost:8088/uploads/${id}?token=${token}`, `${origin}/auth/token?token=${token}`, `${origin}/uploads/${id}?token=${token}&token=${token}`, `${origin}/uploads/${id}?token=short`, `${origin}/uploads/${id}?token=${token}#fragment`]) {
		assert.throws(() => trustedProviderUploadUrl(value, provider));
	}
	assert.throws(() => trustedProviderMediaUrl(`${origin}/uploads/${id}?token=${token}`, provider));
	assert.throws(() => trustedProviderHookUrl(`${origin}/uploads/${id}/fail?token=${token}`, provider, 'success'));
});
test('Audiocity upload and hook destinations preserve the current server expiry hints', () => {
	const provider = providerConfiguration(localEnv);
	const query = `token=${token}&X-Amz-Date=20261017T142305Z&X-Amz-Expires=86400`;
	const upload = `${origin}/uploads/${id}?${query}`;
	assert.equal(trustedProviderUploadUrl(upload, provider).href, upload);
	for (const kind of ['success', 'fail', 'progress'] as const) {
		const hook = `${origin}/uploads/${id}/${kind}?${query}`;
		assert.equal(trustedProviderHookUrl(hook, provider, kind).href, hook);
	}
});
test('Audiocity expiry hints reject partial, malformed, duplicate and unsupported query fields', () => {
	const provider = providerConfiguration(localEnv);
	const valid = `token=${token}&X-Amz-Date=20261017T142305Z&X-Amz-Expires=86400`;
	for (const query of [
		`token=${token}&X-Amz-Date=20261017T142305Z`, `token=${token}&X-Amz-Expires=86400`,
		`${valid}&token=${token}`, `${valid}&X-Amz-Date=20261017T142305Z`, `${valid}&X-Amz-Expires=86400`,
		`${valid}&redirect=https://untrusted.example`, `${valid}&unknown=value`,
		...['20260230T142305Z', '20261317T142305Z', '20261017T242305Z', '2026-10-17T14:23:05Z', 'invalid'].map(date => valid.replace('20261017T142305Z', date)),
		...['0', '-1', '01', '1.5', '1e3', '9007199254740992', 'invalid'].map(expiry => valid.replace('86400', expiry)),
	]) {
		assert.throws(() => trustedProviderUploadUrl(`${origin}/uploads/${id}?${query}`, provider), query);
		assert.throws(() => trustedProviderHookUrl(`${origin}/uploads/${id}/success?${query}`, provider, 'success'), query);
	}
});
test('Audiocity audio normalization accepts UUID resources and pins share/playback destinations', () => {
	const provider = providerConfiguration(localEnv);
	const audio = { id, title: 'Rain', username: 'recorder', author_name: 'Recorder', slug: 'rain', description: '', license: 'arr', is_downloadable: false, play: { duration: 1500, url: `${origin}/media/${id}?expires=1792080000&signature=${token}` } };
	const result = normalizeAudio(audio, provider);
	assert.equal(result.id, id);
	assert.equal(result.url, `${origin}/audio/${id}/play`);
	assert.equal(result.durationSeconds, 1.5);
	assert.match(result.previewUrl ?? '', /^\/api\/audiocom\/preview\?url=/u);
	assert.throws(() => normalizeAudio(audio));
	assert.throws(() => normalizeAudio({ ...audio, play: { ...audio.play, url: 'https://evil.test/media/file' } }, provider));
});

test('Audiocity authorization rejects a token response that omits a requested project scope', () => {
	const tokens = { token_type: 'Bearer', scope: 'public', access_token: 'access', refresh_token: 'refresh', expires_in: 3600 };
	assert.doesNotThrow(() => normalizeTokenPair(tokens));
	assert.throws(() => normalizeTokenPair(tokens, ['public', 'projects']));
	assert.doesNotThrow(() => normalizeTokenPair({ ...tokens, scope: 'public projects' }, ['public', 'projects']));
});
