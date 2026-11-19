/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { nativeMediaHostArguments } from '../desktop/native-media-host-process.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { demuxVideoTiming } from '../src/common/editor/video-timing-demux.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

const host = process.env.FRAMESCAPER_MEDIA_HOST_TEST_BINARY;
const sourceFixture = new URL('../native/framescaper-media-host/tests/fixtures/prores-proxy-64x36-24fps-4frames.mov.b64', import.meta.url);
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

test('native ProRes Proxy retains the last authored picture interval', {
	skip: !host && 'Set FRAMESCAPER_MEDIA_HOST_TEST_BINARY to a locally linked, unshipped FFmpeg 9.0.1 fixture.',
	timeout: 30_000,
}, async context => {
	const scratch = await mkdtemp(join(tmpdir(), 'framescaper-proxy-duration-'));
	context.after(() => rm(scratch, { recursive: true, force: true }));
	const original = Buffer.from(await readFile(sourceFixture, 'utf8'), 'base64');
	const sourcePath = join(scratch, 'source.mov');
	await writeFile(sourcePath, original);
	const fixture = unifiedExactPlanFixture(9);
	const plan = Buffer.from(JSON.stringify(createUnifiedExactRenderPlan({
		...fixture, sources: [{ ...fixture.sources[0], contentSha256: digest(original),
			storageKey: 'source-input', mimeType: 'video/quicktime' }],
	})));
	const planPath = join(scratch, 'plan.json');
	await writeFile(planPath, plan);
	const output = join(scratch, 'proxy.mov');
	const args = nativeMediaHostArguments({
		executablePath: host!, operation: 'media-proxy', plan: { path: planPath, sha256: digest(plan) },
		sources: [{ path: sourcePath, sha256: digest(original), byteLength: original.byteLength, role: 'original' }],
		videoTimingAssets: [], backend: 'native-cpu', maximumOutputBytes: 1024 * 1024, scratchPath: scratch,
		decodeOutputPath: null, destinationRoot: scratch, temporaryOutputPath: output,
		proxyRecipe: { id: 'framescaper-native-prores-proxy-mov-v1', width: 64, height: 36 }, imageSequence: null,
	});
	const run = spawnSync(host!, [...args], { encoding: 'utf8', timeout: 20_000, maxBuffer: 128 * 1024 });
	assert.equal(run.status, 0, run.stderr + run.stdout);
	const timing = await demuxVideoTiming(new Blob([await readFile(output)], { type: 'video/quicktime' }));
	const ticksPerSecond = BigInt(timing.timescale);
	assert.deepEqual(timing.presentationTicks.map(tick => tick * 24n), [0n, 1n, 2n, 3n].map(ordinal => ordinal * ticksPerSecond));
	assert.equal(timing.finalFrameDurationTicks * 24n, ticksPerSecond);
});
