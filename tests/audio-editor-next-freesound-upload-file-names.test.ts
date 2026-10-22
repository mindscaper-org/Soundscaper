/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptOAuthSecret, encodeBase64Url, hashCapability } from '../functions/api/freesound/_shared/oauth-crypto.ts';
import { handleFreesoundUploadRequest } from '../functions/api/freesound/_shared/protected-handlers.ts';
import { createFreesoundApiClient } from '../src/common/editor/ui/workspace/freesound-auth-upload-client.ts';
import { createFreesoundUploadQueue } from '../src/common/editor/ui/workspace/freesound-upload-queue.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { MemoryFreesoundOAuthRepository } from './helpers/freesound-oauth-memory-repository.ts';

for (const [name, expectedName] of [
	['  Field take.wav', 'Field take.wav'],
	['Field\ntake.wav', 'Field-take.wav'],
	['Field\\take.wav', 'Field-take.wav'],
	['Field take.wav', 'Field take.wav'],
] as const) test(`Freesound queue uploads admitted disk filename ${JSON.stringify(name)} through the real authenticated endpoint`, async () => {
	const repository = new MemoryFreesoundOAuthRepository();
	const now = Date.UTC(2026, 8, 22);
	const token = 's'.repeat(43);
	const masterKey = `v1:${encodeBase64Url(new Uint8Array(32).fill(11))}`;
	const grantId = 'file-name-grant';
	repository.grants.set(grantId, { id: grantId, user: { id: 42, username: 'fixture' },
		accessTokenCiphertext: await encryptOAuthSecret('fixture-access', masterKey, `freesound-oauth:${grantId}:access`),
		refreshTokenCiphertext: await encryptOAuthSecret('fixture-refresh', masterKey, `freesound-oauth:${grantId}:refresh`),
		accessExpiresAt: now + 3_600_000, refreshGeneration: 0, refreshLeaseOwner: null, refreshLeaseExpiresAt: null });
	const tokenHash = await hashCapability(token);
	repository.sessions.set(tokenHash, { tokenHash, grantId, clientKind: 'desktop', createdAt: now, expiresAt: now + 86_400_000 });
	const original = new File([encodeWav([Float32Array.of(.25, -.5)], { sampleRate: 48_000, bitDepth: 16 })], name, { type: 'audio/wav', lastModified: 123 });
	const transferred: Array<{ name: string; bytes: Uint8Array }> = [];
	const client = createFreesoundApiClient({ openAuthorization: () => undefined,
		request: async (path, init) => {
			const headers = new Headers(init?.headers);
			headers.set('Authorization', `Bearer ${token}`);
			headers.set('Origin', 'soundscaper-app://bundle');
			return await handleFreesoundUploadRequest({ request: new Request(`https://soundscaper.org${path}`, { ...init, headers }),
				env: { FREESOUND_CLIENT_ID: 'fixture-client', FREESOUND_CLIENT_SECRET: 'fixture-secret', FREESOUND_OAUTH_MASTER_KEY: masterKey }, params: {} }, {
				repository, now: () => now,
				fetchImpl: async (_input, upstream) => {
					const body = new Uint8Array(await new Response(upstream?.body).arrayBuffer());
					const text = new TextDecoder().decode(body);
					transferred.push({ name: decodeURIComponent(/filename\*=UTF-8''([^\r\n]+)/u.exec(text)?.[1] ?? ''), bytes: body });
					return new Response(JSON.stringify({ filename: 'remote.wav' }), { headers: { 'Content-Type': 'application/json' } });
				},
			});
		},
	});
	const queue = createFreesoundUploadQueue({ upload: client.upload, describe: client.describe });
	queue.enqueueFiles([original]);
	await new Promise<void>(resolve => {
		const unsubscribe = queue.subscribe(() => { if (!queue.getSnapshot().active) { unsubscribe(); resolve(); } });
	});
	assert.equal(queue.getSnapshot().items[0]?.status, 'ready-to-publish', queue.getSnapshot().items[0]?.errorMessage);
	assert.equal(transferred.length, 1);
	assert.equal(transferred[0]?.name, expectedName);
	assert.equal(queue.getSnapshot().items[0]?.fileName, name, 'queue retains the original disk name');
	assert.ok(Buffer.from(transferred[0]!.bytes).includes(Buffer.from(await original.arrayBuffer())), 'multipart retains exact PCM WAV bytes');
	assert.equal(original.name, name);
	assert.equal(original.lastModified, 123);
});
