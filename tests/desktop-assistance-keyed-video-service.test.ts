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
import { createLocalAssistanceVideoKeyingPublication } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-publication.ts';
import { publishImportedVideo } from '../src/common/editor/controller/import/internal/source-import-video-publication.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import type { OwnedMediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import type { LocalAssistanceVideoKeyingEncodeResult } from '../src/common/editor/assistance/local-assistance-video-keying-bridge.ts';
import { createFramescaperProjectAssistance } from '../src/framescaper/editor-project-assistance.ts';
import { createFramescaperProjectHistoryAssistance, executeFramescaperProjectCommandAssistance } from '../src/framescaper/editor-project-assistance-history.ts';
import { FRAMESCAPER_ASSISTANCE_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

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
		for (const frameRate of [{ num: 25, den: 1 }, { num: 24000, den: 1001 }, { num: 30000, den: 1001 }, { num: 60000, den: 1001 }]) {
			const frameCount = 27;
			const rgba = Uint8Array.from({ length: 16 * 16 * 4 }, (_value, index) => (index * 17 + Math.floor(index / 4)) % 256);
			const chunks = createAssistanceVisualFramePackV2({ sourceWidth: 16, sourceHeight: 16,
				rasterWidth: 16, rasterHeight: 16, timescale: frameRate.num,
				frames: Array.from({ length: frameCount }, (_value, sourceFrame) => ({ sourceFrame,
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
			assert.equal(result.inspection.timing.presentationTicks.length, frameCount);
			assert.equal(result.inspection.characteristics.hasAlpha, true);
			assert.equal(result.inspection.characteristics.pixelFormat, 'yuva420p');
			assert.equal(result.claim.role, 'keyed-video');
			assert.doesNotMatch(JSON.stringify({ ...result, inspection: undefined }), /path|private/iu);
			const outputPath = await registry.resolveOutputClaimPathForMain(jobId, result.claim);
			await acceptEncodedVideo(result, new Blob([await readFile(outputPath)], { type: 'video/webm' }), frameCount);
		}
		await registry.releaseJob(jobId);
	});

/** Exercise the same owned publication and history admission as the controller after a real encode. */
async function acceptEncodedVideo(result: LocalAssistanceVideoKeyingEncodeResult, body: Blob, frameCount: number): Promise<void> {
	const options = framescaperV20Options();
	options.selection = { startFrame: 0, endFrame: 48_000, trackIds: ['video-track'], clipIds: ['video-clip'], frequencyRange: null, annotationIds: [] };
	options.sources = (options.sources as Record<string, unknown>[]).map((source) => source.kind === 'video' ? createVideoSource({ ...source,
		width: 16, height: 16, sourceFrameCount: frameCount, frameRate: result.inspection.frameRate, timingDecision: undefined,
		sampleFrameCount: Math.ceil(frameCount * result.inspection.frameRate.den * 48_000 / result.inspection.frameRate.num),
	}) : source);
	const project = createFramescaperProjectAssistance(PROFILE, options as never);
	let history = createFramescaperProjectHistoryAssistance(PROFILE, project);
	const records = new Map<string, Readonly<{ body: Blob; metadata: Readonly<Record<string, unknown>> }>>();
	const store = {
		async getMediaAssetMetadata(key: string) { return records.get(key)?.metadata ?? null; },
		async loadMediaAsset(key: string) { return records.get(key)?.body ?? null; },
		async beginMediaAssetWrite(key: string, metadata: Readonly<Record<string, unknown>>,
			admission: Readonly<{ expectedBytes: number; expectedSha256: string }>): Promise<OwnedMediaAssetWriter> {
			const chunks: Uint8Array<ArrayBuffer>[] = []; let bytesWritten = 0;
			return {
				maximumChunkBytes: 1024 * 1024, get bytesWritten() { return bytesWritten; },
				async write(bytes: Uint8Array) { chunks.push(Uint8Array.from(bytes)); bytesWritten += bytes.byteLength; },
				async commit() { throw new Error('An owned publication is required.'); },
				async commitOwned() {
					const record = { body: new Blob(chunks), metadata: { ...metadata, sourceId: key, size: bytesWritten, sha256: admission.expectedSha256 } };
					records.set(key, record);
					return { metadata: record.metadata, async discardIfCurrent() { return records.get(key) === record && records.delete(key); } };
				}, async abort() {},
			};
		},
	};
	const publication = createLocalAssistanceVideoKeyingPublication({
		getProject: () => history.present, getSelectedClipId: () => 'video-clip', isReadOnly: () => false,
		captureProject: () => history.present, assertProject: (token) => assert.strictEqual(token, history.present),
		createId: () => 'keyed-result', preflightStorage: async () => {}, store, inspectOutput: async () => result.inspection,
		publishContent: async ({ storageKey, body: bytes, metadata, signal }) => (await publishImportedVideo(store, storageKey, bytes, metadata, signal)).publication,
		commit: (command) => { history = executeFramescaperProjectCommandAssistance(PROFILE, history, command, { now: '2026-10-23T12:00:00.000Z' }); },
		reloadSourceVisual: async () => {},
	});
	const captured = await publication.capture();
	await publication.accept(captured, { body, sha256: result.claim.sha256, modelId: 'corridorkey-2.0', modelVersion: '2.0.0' });
	assert.equal(history.present.clips.find((clip) => clip.id === 'video-clip')?.sourceId, 'keyed-result');
	assert.equal(records.get('keyed-result')?.metadata.size, body.size);
}
