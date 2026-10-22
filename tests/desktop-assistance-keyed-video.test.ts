/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAssistanceVisualFramePackV2 } from '../src/common/editor/assistance/visual-frame-pack-v2.ts';
import { validateAssistanceKeyedVideoRequest, keyedVideoEncodeArguments, inspectKeyedVideoProbe } from '../desktop/assistance-keyed-video-contract.ts';
import { openAssistanceKeyedVideoFrames } from '../desktop/assistance-keyed-video-frames.ts';

const jobId = 'a'.repeat(40);
function claim(bytes: Uint8Array, id = 'b'.repeat(40)) {
	return { claimVersion: 1 as const, claimId: id, jobId, role: 'keyed-frames' as const,
		mediaType: 'application/vnd.soundscaper.frame-pack', byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex') };
}
const rate = { num: 30000, den: 1001 };

test('keyed video accepts only closed, same-job keyed frame claims and fixed private encode arguments', () => {
	const output = claim(new Uint8Array([1]));
	const request = { contractVersion: 1, jobId, sourceId: 'source', frameRate: rate, outputs: [output] };
	assert.equal(validateAssistanceKeyedVideoRequest(request).outputs[0]?.sha256, output.sha256);
	for (const invalid of [{ ...request, path: '/tmp/private' }, { ...request, outputs: [{ ...output, jobId: 'c'.repeat(40) }] },
		{ ...request, outputs: [output, output] }, { ...request, frameRate: { num: 0, den: 1 } }]) {
		assert.throws(() => validateAssistanceKeyedVideoRequest(invalid));
	}
	const args = keyedVideoEncodeArguments({ width: 1920, height: 1080, frameCount: 3, frameRate: rate }, '/private/output', 10000);
	assert.equal(args[args.indexOf('-i') + 1], 'pipe:3');
	assert.equal(args[args.indexOf('-c:v') + 1], 'libvpx-vp9');
	assert.equal(args[args.indexOf('-pix_fmt', args.indexOf('-i')) + 1], 'yuva420p');
	assert.equal(args[args.indexOf('-lossless') + 1], '1');
	assert.equal(args[args.indexOf('-auto-alt-ref') + 1], '0');
	assert.equal(args[args.indexOf('-framerate') + 1], '30000/1001');
	assert.ok(args.includes('-an'));
});

test('full-raster frame claims are read one frame at a time with exact ordinal and digest custody', async () => {
	const root = await mkdtemp(join(tmpdir(), 'keyed-frames-'));
	try {
		const rgba = Uint8Array.from([1, 2, 3, 0, 4, 5, 6, 127, 7, 8, 9, 255, 10, 11, 12, 62]);
		const bytes = Buffer.concat(createAssistanceVisualFramePackV2({ sourceWidth: 2, sourceHeight: 2,
			rasterWidth: 2, rasterHeight: 2, timescale: 30000,
			frames: [0, 1].map((sourceFrame) => ({ sourceFrame, presentationTick: String(sourceFrame * 1001), rgba })) }));
		const path = join(root, 'frames'); await writeFile(path, bytes);
		const output = claim(bytes);
		const frames = await openAssistanceKeyedVideoFrames([output], async () => ({ path }), rate, new AbortController().signal);
		assert.equal(frames.width, 2); assert.equal(frames.frameCount, 2);
		const seen: Uint8Array[] = [];
		await frames.consume(async (frame) => { seen.push(frame); });
		assert.deepEqual(seen.map((frame) => [...frame]), [[...rgba], [...rgba]]);
		assert.deepEqual(frames.presentationTicks, ['0', '1001']);
		await frames.close();
		const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1; await writeFile(path, corrupt);
		const changed = await openAssistanceKeyedVideoFrames([output], async () => ({ path }), rate, new AbortController().signal);
		await assert.rejects(changed.consume(async () => {}), /digest/u); await changed.close();
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('probe inspection rejects dropped frames, audio and alpha loss while retaining millisecond WebM timing', () => {
	const plan = { width: 2, height: 2, frameCount: 3, frameRate: rate, timescale: 30000,
		presentationTicks: ['0', '1001', '2002'] };
	const probe = { streams: [{ codec_type: 'video', codec_name: 'vp9', width: 2, height: 2,
		time_base: '1/1000', r_frame_rate: '30000/1001', tags: { alpha_mode: '1' } }],
		packets: [0, 33, 67].map((pts) => ({ pts, duration: 33 })) };
	assert.deepEqual(inspectKeyedVideoProbe(probe, plan).timing.presentationTicks, ['0', '33', '67']);
	for (const bad of [{ ...probe, packets: probe.packets.slice(1) },
		{ ...probe, streams: [...probe.streams, { codec_type: 'audio' }] },
		{ ...probe, streams: [{ ...probe.streams[0], tags: {} }] },
		{ ...probe, packets: [{ pts: 0, duration: 33 }, { pts: 35, duration: 33 }, { pts: 67, duration: 33 }] }]) {
		assert.throws(() => inspectKeyedVideoProbe(bad, plan));
	}
});
