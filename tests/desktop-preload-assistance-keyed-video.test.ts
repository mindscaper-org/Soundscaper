/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readDesktopPreloadSource } from './helpers/desktop-preload-source.mjs';
import type { LocalAssistanceVideoKeyingBridge } from '../src/common/editor/assistance/local-assistance-video-keying-bridge.ts';

import { CORRIDORKEY_CHROMA_HINT_DEFAULTS } from '../src/common/editor/assistance/corridorkey-hint-settings.ts';

const jobId = 'a'.repeat(40); const sha256 = 'b'.repeat(64);
const frameClaim = { claimVersion: 1 as const, jobId, claimId: 'c'.repeat(40), role: 'keyed-frames' as const,
	mediaType: 'application/vnd.soundscaper.frame-pack', byteLength: 1024, sha256 };
const videoClaim = { ...frameClaim, claimId: 'd'.repeat(40), role: 'keyed-video', mediaType: 'video/webm' };
const request = { contractVersion: 1 as const, jobId, sourceId: 'source', frameRate: { num: 25, den: 1 }, outputs: [frameClaim] };
const response = { contractVersion: 1, jobId, sourceId: 'source', claim: videoClaim,
	inspection: { width: 2, height: 2, frameCount: 2, frameRate: request.frameRate, sha256,
		timing: { timescale: 1000, presentationTicks: ['0', '40'], finalFrameDurationTicks: '40' },
		characteristics: { videoCodec: 'vp9', hasAlpha: true, bitDepth: 8, pixelFormat: 'yuva420p',
			colorPrimaries: null, colorTransfer: null, colorSpace: null, colorRange: null } } };

test('the sandbox-only alpha encoder helper is an explicit compiled desktop root', () => {
	const config = JSON.parse(readFileSync(new URL('../tsconfig.desktop-runtime.json', import.meta.url), 'utf8'));
	assert.ok(config.include.includes('desktop/assistance-keyed-video-preload.ts'));
});

test('the packaged sandbox exposes pathless keyed-video preflight and authenticated encode claims', async () => {
	const fixture = await loadPreload([true, response]);
	assert.equal(await fixture.videoKeying.available(), true);
	const result = await fixture.videoKeying.encode(request);
	assert.equal(result.claim.role, 'keyed-video');
	assert.deepEqual(JSON.parse(JSON.stringify(result)), response);
	assert.deepEqual(fixture.invocations.map(([channel]) => channel), [
		'soundscaper:v1:assistance:operation:keyed-video-available',
		'soundscaper:v1:assistance:operation:encode-keyed-video',
	]);
});

test('the sandbox rejects path authority, foreign claims and malformed inspection replies', async () => {
	const fixture = await loadPreload([true]);
	await assert.rejects(fixture.videoKeying.encode({ ...request, path: '/private/file' } as never));
	await assert.rejects(fixture.videoKeying.encode({ ...request,
		outputs: [{ ...frameClaim, jobId: 'e'.repeat(40) }] }));
	assert.equal(fixture.invocations.length, 0);
	for (const result of [{ ...response, path: '/private/file' }, { ...response, claim: { ...videoClaim, path: '/private/file' } },
		{ ...response, inspection: { ...response.inspection, characteristics: { ...response.inspection.characteristics, hasAlpha: false } } }]) {
		const invalid = await loadPreload([result]); await assert.rejects(invalid.videoKeying.encode(request));
	}
});

test('the actual operation preload admits video-keying and paired keyed-frame reservations', async () => {
	const fixture = await loadPreload([{ contractVersion: 1, jobId, operation: 'video-keying', outcome: 'consent-declined' }]);
	const input = { ...frameClaim, role: 'frame-pack' };
	const output = { claimVersion: 1, jobId, claimId: 'f'.repeat(40), role: 'keyed-frames',
		mediaType: frameClaim.mediaType, maximumByteLength: frameClaim.byteLength };
	const operation = { contractVersion: 1, jobId, operation: 'video-keying', models: [{ modelId: 'corridorkey-2.0',
		version: '2.0.0', artifactSha256s: [sha256] }], inputs: [input], outputs: [output],
		selectionFence: { projectId: 'project', schemaFamily: 'framescaper', schemaVersion: 1, revision: 1,
			sequenceId: 'sequence', occurrenceIds: ['occurrence'], sourceId: 'source', sourceSha256: sha256,
			sourceStartFrame: 0, sourceEndFrame: 2, linkMembershipSha256: sha256, timingAuthoritySha256: sha256 } };
	await fixture.run(operation);
	assert.equal(fixture.invocations.length, 1);
	for (const settings of [CORRIDORKEY_CHROMA_HINT_DEFAULTS, { settingsVersion: 1, hintMode: 'none' }]) {
		const hinted = await loadPreload([{ contractVersion: 1, jobId, operation: 'video-keying', outcome: 'consent-declined' }]);
		await hinted.run({ ...operation, settings });
		assert.deepEqual(JSON.parse(JSON.stringify(hinted.invocations[0]![1])), { ...operation, settings });
	}
	for (const settings of [{ ...CORRIDORKEY_CHROMA_HINT_DEFAULTS, softness: -1 },
		{ ...CORRIDORKEY_CHROMA_HINT_DEFAULTS, path: '/tmp/matte' }, { settingsVersion: 1, hintMode: 'external' }]) {
		await assert.rejects(fixture.run({ ...operation, settings }));
	}
	assert.equal(fixture.invocations.length, 1);
});

async function loadPreload(responses: unknown[]) {
	interface Bridge { localAssistance: { videoKeying: LocalAssistanceVideoKeyingBridge; run(value: unknown): Promise<unknown> } }
	let bridge: Bridge | undefined; const invocations: [string, unknown][] = [];
	vm.runInNewContext(await readDesktopPreloadSource(), { ArrayBuffer, Array, BigInt, Blob, Error, Map,
		Number, Object, Promise, RangeError, Reflect, String, TypeError, Uint8Array, URL,
		require: () => ({ contextBridge: { exposeInMainWorld(name: string, value: { v1: Bridge }) {
			if (name === 'scapeDesktop') bridge = value.v1;
		} }, ipcRenderer: { invoke(channel: string, value: unknown) {
			invocations.push([channel, value]); return Promise.resolve(responses.shift());
		}, send() {}, on() {}, removeListener() {} } }),
	});
	assert.ok(bridge);
	return { ...bridge.localAssistance, invocations };
}
