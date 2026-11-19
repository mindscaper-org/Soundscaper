/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { encryptOAuthSecret, encodeBase64Url, hashCapability } from '../../functions/api/freesound/_shared/oauth-crypto.ts';
import { handleFreesoundUploadRequest } from '../../functions/api/freesound/_shared/protected-handlers.ts';
import { createFreesoundApiClient } from '../../src/common/editor/ui/workspace/freesound-auth-upload-client.ts';
import { prepareFreesoundUploadFile } from '../../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts';
import { createFreesoundUploadQueue } from '../../src/common/editor/ui/workspace/freesound-upload-queue.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import { assertAudioProjectArchivePcm } from './audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';
import { MemoryFreesoundOAuthRepository } from './freesound-oauth-memory-repository.ts';
import { controllerSession } from './soundscaper-controller-session.ts';

/** Exercise the production authenticated upload boundary; only the remote Freesound server is a port. */
export async function transferFreesoundFile(original: File, expectedName: string, sampleRate: number) {
	const repository = new MemoryFreesoundOAuthRepository(), now = Date.UTC(2026, 8, 22);
	const token = 's'.repeat(43), masterKey = `v1:${encodeBase64Url(new Uint8Array(32).fill(11))}`, grantId = 'custody-grant';
	repository.grants.set(grantId, { id: grantId, user: { id: 42, username: 'fixture' },
		accessTokenCiphertext: await encryptOAuthSecret('fixture-access', masterKey, `freesound-oauth:${grantId}:access`),
		refreshTokenCiphertext: await encryptOAuthSecret('fixture-refresh', masterKey, `freesound-oauth:${grantId}:refresh`),
		accessExpiresAt: now + 3_600_000, refreshGeneration: 0, refreshLeaseOwner: null, refreshLeaseExpiresAt: null });
	const tokenHash = await hashCapability(token);
	repository.sessions.set(tokenHash, { tokenHash, grantId, clientKind: 'desktop', createdAt: now, expiresAt: now + 86_400_000 });
	const transferred: Uint8Array[] = [], files: File[] = [];
	const client = createFreesoundApiClient({ openAuthorization: () => undefined, request: async (path, init) => {
		assert.ok(init?.body instanceof File); files.push(init.body);
		assert.equal(init.body.name, expectedName); assert.equal(init.body.type, 'audio/wav');
		const headers = new Headers(init.headers);
		assert.equal(decodeURIComponent(headers.get('X-Freesound-Filename') ?? ''), expectedName);
		headers.set('Authorization', `Bearer ${token}`); headers.set('Origin', 'soundscaper-app://bundle');
		return await handleFreesoundUploadRequest({ request: new Request(`https://soundscaper.org${path}`, { ...init, headers }),
			env: { FREESOUND_CLIENT_ID: 'fixture-client', FREESOUND_CLIENT_SECRET: 'fixture-secret', FREESOUND_OAUTH_MASTER_KEY: masterKey }, params: {} }, {
				repository, now: () => now, fetchImpl: async (input, upstream) => {
					assert.equal(String(input), 'https://freesound.org/apiv2/sounds/upload/');
					const upstreamHeaders = new Headers(upstream?.headers);
					assert.equal(upstreamHeaders.get('Authorization'), 'Bearer fixture-access');
					const body = new Uint8Array(await new Response(upstream?.body).arrayBuffer());
					const text = new TextDecoder().decode(body);
					assert.equal(decodeURIComponent(/filename\*=UTF-8''([^\r\n]+)/u.exec(text)?.[1] ?? ''), expectedName);
					const boundary = /^multipart\/form-data; boundary=([^;]+)$/u.exec(upstreamHeaders.get('Content-Type') ?? '')?.[1];
					assert.ok(boundary);
					const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audiofile"; filename="upload.wav"; filename*=UTF-8''${encodeURIComponent(expectedName)}\r\nContent-Type: audio/wav\r\n\r\n`);
					const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
					const prepared = files[0]; assert.ok(prepared);
					const expected = Buffer.concat([prefix, Buffer.from(await prepared.arrayBuffer()), suffix]);
					assert.equal(upstreamHeaders.get('Content-Length'), String(expected.length));
					assert.deepEqual(Buffer.from(body), expected, 'one complete multipart part forwards exactly the prepared WAV');
					transferred.push(body);
					return Response.json({ filename: 'remote.wav' });
				},
			});
	} });
	let preparations = 0;
	const queue = createFreesoundUploadQueue({ upload: client.upload, describe: client.describe,
		prepareFile: async (file, signal) => {
			preparations++;
			return await prepareFreesoundUploadFile(file, signal, { createDecodeContext: options => {
				assert.equal(options.sampleRate, sampleRate);
				throw new DOMException('Native decoding is unavailable in this Node custody test.', 'NotSupportedError');
			} });
		} });
	queue.enqueueFiles([original]);
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			unsubscribe();
			queue.clear();
			reject(new Error('The real authenticated upload did not settle within 10 seconds.'));
		}, 10_000);
		const unsubscribe = queue.subscribe(check);
		check();
		function check(): void {
			if (queue.getSnapshot().active) return;
			clearTimeout(timeout);
			unsubscribe();
			resolve();
		}
	});
	const item = queue.getSnapshot().items[0]; assert.ok(item);
	assert.equal(item.status, 'ready-to-publish', item.errorMessage ?? 'the authenticated upload must complete');
	assert.equal(item.sourceKind, 'file'); assert.equal(item.uploadFilename, 'remote.wav');
	assert.equal(files.length, 1); assert.equal(transferred.length, 1);
	const file = files[0]; assert.ok(file);
	assert.ok(Buffer.from(transferred[0]!).includes(Buffer.from(await file.arrayBuffer())), 'the endpoint forwards every prepared WAV byte');
	assert.equal(file.lastModified, original.lastModified);
	return { file, preparations, item };
}

/** Independent decoder for these canonical PCM WAV fixtures, rather than a second call to the owning WAV reader. */
export async function independentUploadedWav(file: File, sampleRate: number, frames: number, bitDepth: 16 | 24,
	expected: readonly number[], tolerance = 2 / 2 ** (bitDepth - 1)) {
	const bytes = Buffer.from(await file.arrayBuffer());
	assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
	assert.equal(bytes.toString('ascii', 12, 16), 'fmt '); assert.equal(bytes.readUInt16LE(20), 1);
	assert.equal(bytes.readUInt16LE(22), 1); assert.equal(bytes.readUInt32LE(24), sampleRate);
	assert.equal(bytes.readUInt16LE(34), bitDepth); assert.equal(bytes.toString('ascii', 36, 40), 'data');
	assert.equal(bytes.readUInt32LE(40), frames * bitDepth / 8); assert.equal(expected.length, frames);
	const pcm = new Float32Array(frames);
	for (let frame = 0; frame < frames; frame++) {
		pcm[frame] = bytes.readIntLE(44 + frame * bitDepth / 8, bitDepth / 8) / 2 ** (bitDepth - 1);
		assert.ok(Math.abs(pcm[frame]! - expected[frame]!) <= tolerance, `independent sample ${frame}`);
	}
	return [pcm];
}

/** Real import/store/history and independent native Scape recipient, with rendering/codec fallbacks forbidden. */
export async function importFreesoundCustody(context: TestContext, file: File, expectedPcm: readonly Float32Array[], sampleRate: number) {
	const f = await controllerSession(context, { engineFactory: () => { throw new Error('No renderer belongs in WAV/metadata custody.'); } });
	const history = f.controller.getSnapshot().history.undoEntries.length;
	await f.controller.actions.project.importFiles([file], { destination: 'project-bin', projectBinVisible: true });
	const project: unknown = f.controller.project; assert.ok(validateSoundscaperProject(project));
	assert.equal(project.sources.length, 1); assert.equal(project.clips.length, 0); assert.equal(project.projectBin.clips.length, 1);
	const source = project.sources[0]; assert.ok(source?.kind === 'audio');
	assert.deepEqual([source.sampleRate, source.channelCount, source.frameCount], [sampleRate, expectedPcm.length, expectedPcm[0]?.length]);
	assert.equal(f.controller.getSnapshot().history.undoEntries.length, history + 1);
	await f.controller.actions.edit.undo(); assert.equal(f.controller.project?.sources.length, 0);
	await f.controller.actions.edit.redo();
	await f.controller.actions.project.save();
	const reopened = await assertAudioProjectArchivePcm(context, f.store, f.controller.project, (_name, channels) => {
		assertPcmChannelsEqual(channels, expectedPcm, 'independently checked WAV PCM survives import and Scape');
	});
	assert.equal(reopened.projectBin.clips.length, 1); assert.equal(reopened.clips.length, 0);
	return reopened;
}
