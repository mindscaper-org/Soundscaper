/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assistanceNativeKeyedPlan } from '../desktop/assistance-native-keyed-video-plan.ts';
import { inspectKeyedVideoProbe } from '../desktop/assistance-keyed-video-contract.ts';
import { createAssistanceKeyedVideoService } from '../desktop/assistance-keyed-video-service.ts';
import { nativeMediaHostArguments } from '../desktop/native-media-host-process.ts';
import { parseNativeMediaHostControl } from '../desktop/native-media-host-result.ts';
import { nativeRgbaFramePackV1ByteLength } from '../src/common/editor/native-rgba-frame-pack-v1-contract.ts';
import { nativeMediaV14EncodeDispatch } from '../src/common/editor/native-media-v14-native-dispatch.ts';
import {
	FRAMESCAPER_NATIVE_WEBM_CODECS,
	framescaperNativeMediaNativeDeliveryProfile,
	snapshotFramescaperNativeRenderDeliveryRequestNativeMedia,
} from '../src/framescaper/editor-native-project-action-requests.ts';

const jobId = 'ab'.repeat(20);
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

test('native WebM menu requests select exact codec tuples and keep transparency opt-in', () => {
	for (const codec of FRAMESCAPER_NATIVE_WEBM_CODECS) {
		const delivery = snapshotFramescaperNativeRenderDeliveryRequestNativeMedia({ kind: 'encoded-webm', codec, quality: 'draft' });
		const profile = nativeMediaV14EncodeDispatch(framescaperNativeMediaNativeDeliveryProfile(delivery));
		assert.equal(profile.muxer, 'webm');
		assert.equal(profile.supportsAlpha, codec === 'vp9-alpha');
		assert.equal(profile.audioEncoder, 'libopus');
	}
	for (const invalid of [
		{ kind: 'encoded-webm', codec: 'h264', quality: 'draft' },
		{ kind: 'encoded-webm', codec: 'av1', quality: 'unchecked' },
		{ kind: 'encoded-webm', codec: 'av1', quality: 'draft', arguments: ['--anything'] },
	]) assert.throws(() => snapshotFramescaperNativeRenderDeliveryRequestNativeMedia(invalid));
});

test('keying prefers the bundled encoder and never retries an execution failure externally', async () => {
	let calls = 0;
	const failure = new Error('native execution failed');
	const service = createAssistanceKeyedVideoService({
		operations: { assertJob: () => {} } as never, registry: {} as never,
		preferences: { admission: () => { throw new Error('External FFmpeg must not be probed.'); },
			invalidateAdmission: async () => { throw new Error('External FFmpeg must not be invalidated.'); } },
		nativeEncoder: { available: async () => true, encode: async () => { calls++; throw failure; } },
	});
	try {
		assert.equal(await service.available(), true);
		await assert.rejects(service.encode({ contractVersion: 1, jobId, sourceId: 'source', frameRate: { num: 25, den: 1 },
			outputs: [{ claimVersion: 1, claimId: 'cd'.repeat(20), jobId, role: 'keyed-frames',
				mediaType: 'application/vnd.soundscaper.frame-pack', byteLength: 1, sha256: 'ef'.repeat(32) }] }), error => error === failure);
		assert.equal(calls, 1);
	} finally { await service.dispose(); }
});

const binary = process.env.FRAMESCAPER_MEDIA_HOST_TEST_BINARY;
test('the linked host preserves every alpha byte and exact fractional timing in the keying carrier',
	{ skip: !binary, timeout: 60_000 }, async t => {
		const directory = await mkdtemp(join(tmpdir(), 'native-keyed-webm-'));
		t.after(() => rm(directory, { recursive: true, force: true }));
		for (const rate of [{ num: 25, den: 1 }, { num: 24_000, den: 1_001 }, { num: 30_000, den: 1_001 }]) {
			const scratch = await mkdtemp(join(directory, 'encode-'));
			const frames = { width: 64, height: 64, frameCount: 4, frameRate: rate,
				timescale: rate.num, presentationTicks: Array.from({ length: 4 }, (_, index) => String(index * rate.den)) };
			const plan = Buffer.from(JSON.stringify(assistanceNativeKeyedPlan(jobId, frames)));
			const planPath = join(scratch, 'plan.json'); await writeFile(planPath, plan);
			const byteLength = nativeRgbaFramePackV1ByteLength(frames);
			const carrier = Buffer.alloc(byteLength); const magic = Buffer.from('framescaper-rgba-frame-pack-v1\n'); magic.copy(carrier);
			const base = magic.length;
			carrier.writeUInt32LE(1, base); carrier.writeUInt32LE(64, base + 4); carrier.writeUInt32LE(64, base + 8);
			carrier.writeBigUInt64LE(4n, base + 12); carrier.writeUInt32LE(rate.den, base + 20); carrier.writeUInt32LE(rate.num, base + 24);
			let position = base + 28;
			for (let ordinal = 0; ordinal < 4; ordinal++) {
				carrier.writeBigUInt64LE(BigInt(ordinal), position); carrier.writeBigInt64LE(BigInt(ordinal), position + 8);
				carrier.writeBigInt64LE(1n, position + 16); carrier.writeBigUInt64LE(64n * 64n * 4n, position + 24); position += 32;
				for (let pixel = 0; pixel < 64 * 64; pixel++) {
					carrier[position + pixel * 4] = 160; carrier[position + pixel * 4 + 3] = (pixel + ordinal) % 256;
				}
				position += 64 * 64 * 4;
			}
			const output = join(scratch, 'keyed.webm');
			const args = nativeMediaHostArguments({ executablePath: binary!, operation: 'media-encode',
				plan: { path: planPath, sha256: digest(plan) },
				sources: [{ path: null, sha256: null, byteLength, role: 'evaluated-rgba-frame-pack',
					liveInput: { transport: 'native-pipe', byteLength } }], videoTimingAssets: [],
				backend: 'native-cpu', maximumOutputBytes: 1024 * 1024, scratchPath: scratch,
				decodeOutputPath: null, destinationRoot: scratch, temporaryOutputPath: output, proxyRecipe: null, imageSequence: null });
			const result = spawnSync(binary!, [...args], { input: carrier, encoding: 'utf8', timeout: 30_000, maxBuffer: 128 * 1024 });
			assert.equal(result.status, 0, result.stdout + result.stderr);
			const control = parseNativeMediaHostControl('media-encode', result.stdout);
			assert.ok('sha256' in control);
			assert.equal(digest(await readFile(output)), control.sha256);
			const report = JSON.parse(String(await readFile(join(scratch, 'keyed-video-inspection.json')))) as { outputSha256: string; probe: unknown };
			assert.equal(report.outputSha256, control.sha256);
			assert.equal(inspectKeyedVideoProbe(report.probe, frames).frameCount, 4);
		}
	});
