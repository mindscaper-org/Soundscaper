/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { nativeMediaHostArguments } from '../desktop/native-media-host-process.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { demuxVideoTiming } from '../src/common/editor/video-timing-demux.ts';
import { readContainerVideoSourceCharacteristics } from '../src/common/editor/video-container-characteristics.ts';
import { videoSourceGeometryMedia } from './browser/fixtures/video-source-geometry-media.js';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

const host = process.env.FRAMESCAPER_MEDIA_HOST_TEST_BINARY;
const sourceFixture = new URL('../native/framescaper-media-host/tests/fixtures/prores-proxy-64x36-24fps-4frames.mov.b64', import.meta.url);
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const hostTest = {
	skip: !host && 'Set FRAMESCAPER_MEDIA_HOST_TEST_BINARY to a locally linked, unshipped FFmpeg 9.0.1 fixture.',
	timeout: 30_000,
} as const;

test('native ProRes Proxy retains the last authored picture interval', hostTest, async context => {
	const original = Buffer.from(await readFile(sourceFixture, 'utf8'), 'base64');
	const output = await generateProxy(context, original, { width: 64, height: 36 }, 'video/quicktime');
	const timing = await demuxVideoTiming(output);
	const ticksPerSecond = BigInt(timing.timescale);
	assert.deepEqual(timing.presentationTicks.map(tick => tick * 24n), [0n, 1n, 2n, 3n].map(ordinal => ordinal * ticksPerSecond));
	assert.equal(timing.finalFrameDurationTicks * 24n, ticksPerSecond);
	const geometry = await readContainerVideoSourceCharacteristics(output);
	assert.equal(geometry.rotationDegrees, null);
	assert.ok(geometry.pixelAspectRatio === null || geometry.pixelAspectRatio.num === geometry.pixelAspectRatio.den);
});

test('native ProRes Proxy preserves rotated anamorphic picture geometry', hostTest, async context => {
	const fixture = videoSourceGeometryMedia.find(({ id }) => id === 'geometry-rotated-anamorphic-mp4-v1')!;
	const output = await generateProxy(context, fixture.file.buffer, fixture.coded, fixture.file.mimeType);
	const { codedWidth, codedHeight, rotationDegrees, pixelAspectRatio } = await readContainerVideoSourceCharacteristics(output);
	assert.deepEqual({ codedWidth, codedHeight, rotationDegrees, pixelAspectRatio }, {
		codedWidth: 192, codedHeight: 144, rotationDegrees: 270, pixelAspectRatio: { num: 2, den: 1 },
	});
	assert.equal((await demuxVideoTiming(output)).presentationTicks.length, 22);
});

async function generateProxy(context: TestContext, original: Buffer, geometry: { width: number; height: number }, mimeType: string): Promise<Blob> {
	const scratch = await mkdtemp(join(tmpdir(), 'framescaper-native-proxy-'));
	context.after(() => rm(scratch, { recursive: true, force: true }));
	const sourcePath = join(scratch, 'original.media');
	await writeFile(sourcePath, original);
	const fixture = unifiedExactPlanFixture(9);
	const plan = Buffer.from(JSON.stringify(createUnifiedExactRenderPlan({
		...fixture, sources: [{ ...fixture.sources[0], contentSha256: digest(original),
			storageKey: 'source-input', mimeType }],
	})));
	const planPath = join(scratch, 'plan.json');
	await writeFile(planPath, plan);
	const output = join(scratch, 'proxy.mov');
	const args = nativeMediaHostArguments({
		executablePath: host!, operation: 'media-proxy', plan: { path: planPath, sha256: digest(plan) },
		sources: [{ path: sourcePath, sha256: digest(original), byteLength: original.byteLength, role: 'original' }],
		videoTimingAssets: [], backend: 'native-cpu', maximumOutputBytes: 1024 * 1024, scratchPath: scratch,
		decodeOutputPath: null, destinationRoot: scratch, temporaryOutputPath: output,
		proxyRecipe: { id: 'framescaper-native-prores-proxy-mov-v1', ...geometry }, imageSequence: null,
	});
	const run = spawnSync(host!, [...args], { encoding: 'utf8', timeout: 20_000, maxBuffer: 128 * 1024 });
	assert.equal(run.status, 0, run.stderr + run.stdout);
	return new Blob([await readFile(output)], { type: 'video/quicktime' });
}
