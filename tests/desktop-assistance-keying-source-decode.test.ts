/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssistanceStagingRegistry } from '../desktop/assistance-staging-registry.ts';
import { createAssistanceKeyingSourceDecodeService } from '../desktop/assistance-keyed-video-decode.ts';
import { validateKeyingSourceDecodeRequest } from '../desktop/assistance-keyed-video-decode-contract.ts';
import { createAssistanceKeyedVideoPreloadBridge } from '../desktop/assistance-keyed-video-preload.ts';
import { validateAssistanceOutputClaim } from '../desktop/assistance-data-claims.ts';
import { lazyLocalAssistanceVideoKeyingBridge } from '../src/common/editor/assistance/local-assistance-video-keying-bridge.ts';
import { admittedExternalFfmpeg } from './helpers/keying-source-decode-fixture.ts';

test('source decode admits only bounded exact job-owned original-video authority', () => {
	const source = { claimVersion: 1, jobId: 'a'.repeat(40), claimId: 'b'.repeat(40), role: 'video',
		mediaType: 'video/quicktime', byteLength: 100, sha256: 'c'.repeat(64) };
	const request = { contractVersion: 1, jobId: source.jobId, source, width: 64, height: 64,
		frameCount: 3, frameRate: { num: 25, den: 1 } };
	assert.deepEqual(validateKeyingSourceDecodeRequest(request), request);
	assert.equal(validateKeyingSourceDecodeRequest({ ...request, source: { ...source, mediaType: 'application/mxf' } }).source.mediaType, 'application/mxf');
	for (const invalid of [{ ...request, path: '/tmp/movie' }, { ...request, width: 4097 },
		{ ...request, source: { ...source, role: 'frame-pack' } }, { ...request, frameCount: 1000000 },
		{ ...request, source: { ...source, jobId: 'd'.repeat(40) } }]) {
		assert.throws(() => validateKeyingSourceDecodeRequest(invalid));
	}
});

test('native extraction decodes opaque SDR ProRes into exact bounded RGBA reads and releases custody', async context => {
	const binaryDirectory = process.env.SCAPE_TEST_ALPHA_FFMPEG_DIRECTORY;
	if (!binaryDirectory) { context.skip('Set SCAPE_TEST_ALPHA_FFMPEG_DIRECTORY for the real native source decode.'); return; }
	const root = await mkdtemp(join(tmpdir(), 'keying-source-decode-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const registry = new AssistanceStagingRegistry({ root });
	const jobId = await registry.createJob();
	const bytes = await readFile(new URL('./browser/fixtures/corridorkey/prores-green.mov', import.meta.url));
	const source = await registry.stageInput({ jobId, role: 'video', mediaType: 'video/quicktime',
		byteLength: bytes.length, bytes: (async function* () { yield bytes; })() });
	const preferences = await admittedExternalFfmpeg(binaryDirectory);
	const service = createAssistanceKeyingSourceDecodeService({ registry,
		operations: { assertJob(id) { assert.equal(id, jobId); } }, preferences });
	context.after(() => service.dispose());
	const preload = createAssistanceKeyedVideoPreloadBridge({ claim: validateAssistanceOutputClaim, invoke: async (channel, value) => (
		channel.endsWith('decode-keying-source') ? service.decode(value) : service.read(value)
	) });
	const renderer = lazyLocalAssistanceVideoKeyingBridge(preload)!;
	const decoded = await renderer.decodeSource!({ contractVersion: 1, jobId, source: { ...source, role: 'video' }, width: 64, height: 64,
		frameCount: 3, frameRate: { num: 25, den: 1 } });
	assert.equal(decoded.byteLength, 64 * 64 * 4 * 3);
	const first = await renderer.readDecodedSource!({ jobId, offset: 0, maximumBytes: 64 * 64 * 4 });
	assert.equal(first.length, 64 * 64 * 4);
	for (let pixel = 0; pixel < first.length; pixel += 4) assert.equal(first[pixel + 3], 255);
	assert.ok(first[1]! > first[0]! + 50 && first[1]! > first[2]! + 50);
	await assert.rejects(service.read({ jobId, offset: decoded.byteLength, maximumBytes: 1 }));
	await assert.rejects(service.read({ jobId, offset: 0, maximumBytes: 4 * 1024 ** 2 + 1 }));
	await service.cancel(jobId);
	await assert.rejects(service.read({ jobId, offset: 0, maximumBytes: 1 }));
	await assert.rejects(service.decode({ contractVersion: 1, jobId, source, width: 64, height: 64, frameCount: 2, frameRate: { num: 25, den: 1 } }), /frame inventory/u);
	await registry.releaseJob(jobId);
});

test('native decode cancellation quiesces before releasing the staged original', async context => {
	const directory = process.env.SCAPE_TEST_ALPHA_FFMPEG_DIRECTORY;
	if (!directory) { context.skip('Set SCAPE_TEST_ALPHA_FFMPEG_DIRECTORY for native cancellation.'); return; }
	const root = await mkdtemp(join(tmpdir(), 'keying-decode-cancel-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const registry = new AssistanceStagingRegistry({ root }); const jobId = await registry.createJob();
	const bytes = await readFile(new URL('./browser/fixtures/corridorkey/prores-green.mov', import.meta.url));
	const source = await registry.stageInput({ jobId, role: 'video', mediaType: 'video/quicktime', byteLength: bytes.length,
		bytes: (async function* () { yield bytes; })() });
	const service = createAssistanceKeyingSourceDecodeService({ registry, operations: { assertJob() {} }, preferences: await admittedExternalFfmpeg(directory) });
	const pending = service.decode({ contractVersion: 1, jobId, source, width: 64, height: 64, frameCount: 3, frameRate: { num: 25, den: 1 } });
	const rejected = assert.rejects(pending);
	await Promise.all([service.cancel(jobId), service.cancel(jobId)]); await rejected;
	await registry.releaseJob(jobId); await service.dispose();
});

for (const [name, inputMetadata, outputMetadata] of [
	['non-square pixels', [], ['-aspect', '2:1']],
	['display rotation', ['-display_rotation', '90'], []],
	['display reflection', ['-display_vflip'], []],
] as const) test(`native extraction rejects ProRes ${name} before changing display geometry`, async context => {
	const binaryDirectory = process.env.SCAPE_TEST_ALPHA_FFMPEG_DIRECTORY;
	if (!binaryDirectory) { context.skip('Set SCAPE_TEST_ALPHA_FFMPEG_DIRECTORY for source display metadata checks.'); return; }
	const root = await mkdtemp(join(tmpdir(), 'keying-source-display-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const original = new URL('./browser/fixtures/corridorkey/prores-green.mov', import.meta.url);
	const transformed = join(root, 'transformed.mov');
	const remux = spawnSync(join(binaryDirectory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
		['-nostdin', '-v', 'error', '-y', ...inputMetadata, '-i', fileURLToPath(original), '-map', '0:v:0', '-c', 'copy', ...outputMetadata, transformed],
		{ encoding: 'utf8' });
	assert.equal(remux.status, 0, remux.stderr);
	const probe = spawnSync(join(binaryDirectory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
		['-v', 'error', '-show_entries', 'stream=sample_aspect_ratio:stream_side_data=rotation,displaymatrix', '-of', 'json', transformed], { encoding: 'utf8' });
	assert.equal(probe.status, 0, probe.stderr);
	const metadata = JSON.parse(probe.stdout) as { streams: { sample_aspect_ratio?: string; side_data_list?: unknown[] }[] };
	if (name === 'non-square pixels') assert.equal(metadata.streams[0]?.sample_aspect_ratio, '2:1');
	else assert.ok(metadata.streams[0]?.side_data_list?.length, 'The remux must retain its transformed display matrix.');
	const registry = new AssistanceStagingRegistry({ root: join(root, 'staging') });
	const jobId = await registry.createJob(); const bytes = await readFile(transformed);
	const source = await registry.stageInput({ jobId, role: 'video', mediaType: 'video/quicktime', byteLength: bytes.length,
		bytes: (async function* () { yield bytes; })() });
	const service = createAssistanceKeyingSourceDecodeService({ registry, operations: { assertJob(id) { assert.equal(id, jobId); } },
		preferences: await admittedExternalFfmpeg(binaryDirectory) });
	try {
		await assert.rejects(service.decode({ contractVersion: 1, jobId, source, width: 64, height: 64,
			frameCount: 3, frameRate: { num: 25, den: 1 } }), /display geometry|pixel aspect|rotation/u);
	} finally { await service.dispose(); await registry.releaseJob(jobId); }
});
