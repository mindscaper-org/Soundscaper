/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAssistanceKeyedVideoService } from '../desktop/assistance-keyed-video-service.ts';
import { AssistanceStagingRegistry } from '../desktop/assistance-staging-registry.ts';
import { externalFfmpegExecutablePairClosureSha256 } from '../desktop/external-ffmpeg-node-runtime.ts';
import { createAssistanceKeyedVideoPreloadBridge } from '../desktop/assistance-keyed-video-preload.ts';
import { validateAssistanceOutputClaim } from '../desktop/assistance-data-claims.ts';
import { lazyLocalAssistanceVideoKeyingBridge } from '../src/common/editor/assistance/local-assistance-video-keying-bridge.ts';
import { createAssistanceVisualFramePackV2 } from '../src/common/editor/assistance/visual-frame-pack-v2.ts';

test('alpha encoder preflight rejects missing authenticated executable capabilities before touching a job', async () => {
	const service = createAssistanceKeyedVideoService({ operations: { assertJob() { throw new Error('unexpected job access'); } } as never,
		registry: {} as never, preferences: { admission: () => null, invalidateAdmission: async () => true } as never });
	assert.equal(await service.available(), false); await service.dispose();
});

test('preflight requires every encoder, decoder, container and alpha-filter capability', async () => {
	const capabilities = { encoders: ['libvpx-vp9', 'rawvideo'], decoders: ['libvpx-vp9', 'rawvideo'], muxers: ['webm', 'framemd5'],
		demuxers: ['rawvideo', 'matroska'], filters: ['split', 'format', 'alphaextract', 'alphamerge'] };
	const executablePath = '/unopened/ffmpeg'; const ffprobePath = '/unopened/ffprobe'; const sha256 = 'a'.repeat(64);
	for (const kind of Object.keys(capabilities) as (keyof typeof capabilities)[]) {
		for (const missing of capabilities[kind]) {
			const service = createAssistanceKeyedVideoService({ operations: {} as never, registry: {} as never,
				preferences: { admission: () => ({ executablePath, version: 'test', capabilityGeneration: 'test',
					identity: { version: 'test', ffmpegSha256: sha256, ffprobePath, ffprobeSha256: sha256,
						executablePairClosureSha256: externalFfmpegExecutablePairClosureSha256({
							ffmpegPath: executablePath, ffmpegSha256: sha256, ffprobePath, ffprobeSha256: sha256 }) },
					capabilities: { ...capabilities, [kind]: capabilities[kind].filter((name) => name !== missing) } }),
				invalidateAdmission: async () => { throw new Error('Unexpected executable access.'); },
			} });
			assert.equal(await service.available(), false, `missing ${kind}:${missing}`); await service.dispose();
		}
	}
});

test('actual registry capacity rejects an over-budget video before any process can launch', async (t) => {
	const temporary = await mkdtemp(join(tmpdir(), 'keyed-video-budget-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	const registry = new AssistanceStagingRegistry({ root: join(temporary, 'private'), maximumAggregateBytesPerJob: 8 * 1024 ** 3 });
	const jobId = await registry.createJob();
	const executablePath = join(temporary, 'ffmpeg'); const ffprobePath = join(temporary, 'ffprobe');
	await writeFile(executablePath, 'not executable'); await writeFile(ffprobePath, 'not executable');
	const sha256 = createHash('sha256').update('not executable').digest('hex');
	const admission = { executablePath, version: 'test', capabilityGeneration: 'test',
		identity: { version: 'test', ffmpegSha256: sha256, ffprobePath, ffprobeSha256: sha256,
			executablePairClosureSha256: externalFfmpegExecutablePairClosureSha256({
				ffmpegPath: executablePath, ffmpegSha256: sha256, ffprobePath, ffprobeSha256: sha256 }) },
		capabilities: { encoders: ['libvpx-vp9', 'rawvideo'], decoders: ['libvpx-vp9', 'rawvideo'], muxers: ['webm', 'framemd5'],
			demuxers: ['rawvideo', 'matroska'], filters: ['split', 'format', 'alphaextract', 'alphamerge'] } };
	const bytes = Buffer.concat(createAssistanceVisualFramePackV2({ sourceWidth: 2, sourceHeight: 2,
		rasterWidth: 2, rasterHeight: 2, timescale: 25, frames: [{ sourceFrame: 0, presentationTick: '0', rgba: new Uint8Array(16) }] }));
	const reservation = await registry.reserveOutput({ jobId, role: 'keyed-frames', mediaType: 'application/vnd.soundscaper.frame-pack', maximumByteLength: bytes.length });
	await writeFile(await registry.resolveOutputReservationPathForMain(jobId, reservation), bytes, { flag: 'r+' });
	const claim = await registry.authenticateOutput(jobId, reservation);
	await registry.reserveOutput({ jobId, role: 'transcript', mediaType: 'application/json', maximumByteLength: 8 * 1024 ** 3 - 1024 ** 2 });
	const service = createAssistanceKeyedVideoService({ registry, preferences: { admission: () => admission,
		invalidateAdmission: async () => { throw new Error('Unexpected executable drift.'); } },
		operations: { assertJob: (value: string) => assert.equal(value, jobId),
			openOutput: async ({ claim }: { claim: unknown }) => ({ path: await registry.resolveOutputClaimPathForMain(jobId, claim) }) } as never });
	await assert.rejects(service.encode({ contractVersion: 1, jobId, sourceId: 'source', frameRate: { num: 25, den: 1 }, outputs: [claim] }), /aggregate bytes/u);
	await service.dispose(); await registry.releaseJob(jobId);
});

const executableDirectory = process.env.SCAPE_TEST_ALPHA_FFMPEG_DIRECTORY;
test('real lossless VP9 alpha survives claim custody, all-frame decode verification and the actual renderer bridge',
	{ skip: !executableDirectory, timeout: 120_000 }, async (t) => {
		const temporary = await mkdtemp(join(tmpdir(), 'keyed-video-service-'));
		t.after(() => rm(temporary, { recursive: true, force: true }));
		const registry = new AssistanceStagingRegistry({ root: join(temporary, 'private') });
		const jobId = await registry.createJob();
		const executablePath = join(executableDirectory!, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
		const ffprobePath = join(executableDirectory!, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
		const digest = async (path: string): Promise<string> => createHash('sha256').update(await readFile(path)).digest('hex');
		const ffmpegSha256 = await digest(executablePath); const ffprobeSha256 = await digest(ffprobePath);
		const admission = { executablePath, version: 'test-authenticated', capabilityGeneration: 'alpha-test',
			identity: { version: 'test-authenticated', ffmpegSha256, ffprobePath, ffprobeSha256, executablePairClosureSha256:
				externalFfmpegExecutablePairClosureSha256({ ffmpegPath: executablePath, ffmpegSha256, ffprobePath, ffprobeSha256 }) },
			capabilities: { encoders: ['libvpx-vp9', 'rawvideo'], decoders: ['libvpx-vp9', 'rawvideo'], muxers: ['webm', 'framemd5'],
				demuxers: ['rawvideo', 'matroska'], filters: ['split', 'format', 'alphaextract', 'alphamerge'] } };
		const service = createAssistanceKeyedVideoService({ registry, preferences: {
			admission: () => admission, invalidateAdmission: async () => { throw new Error('Unexpected executable identity change.'); },
		}, operations: { assertJob: (value: string) => assert.equal(value, jobId),
			openOutput: async ({ claim }: { claim: unknown }) => ({ path: await registry.resolveOutputClaimPathForMain(jobId, claim) }),
		} as never });
		t.after(() => service.dispose());
		assert.equal(await service.available(), true);
		for (const frameRate of [{ num: 25, den: 1 }, { num: 30000, den: 1001 }]) {
			const rgba = Uint8Array.from({ length: 16 * 16 * 4 }, (_value, index) => (index * 17 + Math.floor(index / 4)) % 256);
			const chunks = createAssistanceVisualFramePackV2({ sourceWidth: 16, sourceHeight: 16,
				rasterWidth: 16, rasterHeight: 16, timescale: frameRate.num,
				frames: Array.from({ length: 5 }, (_value, sourceFrame) => ({ sourceFrame,
					presentationTick: String(sourceFrame * frameRate.den), rgba: sourceFrame % 2 ? rgba.map((value, index) => index % 4 === 3 ? 255 - value : value) : rgba })) });
			const bytes = Buffer.concat(chunks);
			const reservation = await registry.reserveOutput({ jobId, role: 'keyed-frames', mediaType: 'application/vnd.soundscaper.frame-pack', maximumByteLength: bytes.length });
			const path = await registry.resolveOutputReservationPathForMain(jobId, reservation);
			await writeFile(path, bytes, { flag: 'r+' });
			const claim = await registry.authenticateOutput(jobId, reservation);
			const preload = createAssistanceKeyedVideoPreloadBridge({ claim: validateAssistanceOutputClaim,
				invoke: async (channel, value) => channel.endsWith('keyed-video-available') ? service.available() : service.encode(value) });
			const renderer = lazyLocalAssistanceVideoKeyingBridge(preload)!;
			assert.equal(await renderer.available(), true);
			const result = await renderer.encode({ contractVersion: 1, jobId, sourceId: 'source', frameRate,
				outputs: [{ ...claim, role: 'keyed-frames' }] });
			assert.equal(result.inspection.timing.presentationTicks.length, 5);
			assert.equal(result.inspection.characteristics.hasAlpha, true);
			assert.equal(result.inspection.characteristics.pixelFormat, 'yuva420p');
			assert.equal(result.claim.role, 'keyed-video');
			assert.doesNotMatch(JSON.stringify({ ...result, inspection: undefined }), /path|private/iu);
		}
		await registry.releaseJob(jobId);
	});
