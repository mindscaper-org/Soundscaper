/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createDesktopExternalFfmpegVideoCapabilities,
	createDesktopExternalFfmpegVideoWorkload,
} from '../desktop/desktop-video-codec-operation-contract.ts';
import { validateSaveChoice } from '../desktop/validation.js';
import { captureDirectVideoContract } from '../src/common/editor/controller/export/internal/direct/direct-video-plan-contract.ts';
import { desktopVideoExportCapabilities } from '../src/common/editor/desktop-video-export-capability.ts';
import { resolvePlatformVideoDeliveryEncoder } from '../src/common/editor/platform-video-delivery-encoder.ts';
import { createExportDialogRequest, isVideoExportDialogFormat } from '../src/common/editor/ui/export-dialog-model.js';
import { getVideoExportFormat } from '../src/common/editor/video-export-formats.ts';
import { assertVideoKeyframeExportPlanV7 } from '../src/common/editor/video-keyframe-export-plan-v7.ts';
import { assertFiniteVideoKeyframeContainer } from '../src/common/editor/video-keyframe-video-container.ts';
import { assertFiniteVideoKeyframeContainerFile } from '../src/common/editor/video-keyframe-video-container-stream.ts';
import { streamVideoKeyframeVideoOutput } from '../src/common/editor/video-keyframe-video-output.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperVideoKeyframeExportPlan } from '../src/soundscaper/video-export-plan.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const PLAN = {
	schemaVersion: 1, format: 'mov', quality: 'high', width: 2, height: 2,
	frameRate: { num: 1, den: 1 }, frameCount: 2, sampleRate: 48_000,
	durationFrames: 96_000, videoInputBytes: 32, audioInputBytes: 128,
	ringCapacityBytes: 4_096, audioRingCapacityBytes: 4_096, maximumOutputBytes: 1024 * 1024,
};
const CAPABILITIES = {
	encoders: ['libx264', 'aac'], muxers: ['mov'], decoders: ['rawvideo', 'pcm_f32le'],
	demuxers: ['rawvideo', 'wav'], filters: ['apad'],
};
const MOV = Uint8Array.of(
	0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0, 0, 0, 0,
	0, 0, 0, 9, 0x6d, 0x6f, 0x6f, 0x76, 0,
	0, 0, 0, 9, 0x6d, 0x64, 0x61, 0x74, 0,
);

test('MOV is routed as video and creates an exact Soundscaper delivery and save contract', () => {
	assert.equal(isVideoExportDialogFormat('video-mov'), true);
	assert.equal(createExportDialogRequest({ format: 'video-mov', range: 'project' }).format, 'video-mov');
	const descriptor = getVideoExportFormat('mov');
	assert.equal(descriptor.extension, 'mov');
	assert.equal(descriptor.mimeType, 'video/quicktime');
	const project = createSoundscaperProject(framescaperV20Options() as never);
	const plan = createSoundscaperVideoKeyframeExportPlan(createSoundscaperProjectRuntimeSelection(), project, {
		format: 'mov', includeAudio: true, quality: 'high',
	});
	assert.equal(plan.container, 'mov');
	assert.equal(plan.extension, 'mov');
	assert.equal(plan.mimeType, 'video/quicktime');
	assert.equal(plan.codecs.video, 'h264');
	assert.equal(plan.codecs.audio, 'aac');
	assertVideoKeyframeExportPlanV7(structuredClone(plan));
	assert.equal(captureDirectVideoContract(plan, 'delivery.mov')?.descriptor.id, 'mov');
	assert.equal(captureDirectVideoContract(plan, 'delivery.mp4'), null);
	const save = validateSaveChoice({ purpose: 'video', suggestedName: 'delivery.mov' });
	assert.equal(save.suggestedName, 'delivery.mov');
	assert.ok(save.filters[0]!.extensions.includes('mov'));
});

test('MOV uses an actual QuickTime muxer with the selected quality and optional audio', () => {
	const result = createDesktopExternalFfmpegVideoWorkload(PLAN, { outputPath: '/private/output.mov' });
	const args = result.ffmpegArguments;
	assert.equal(result.workload.extension, '.mov');
	assert.equal(result.workload.mimeType, 'video/quicktime');
	assert.equal(args[args.lastIndexOf('-f') + 1], 'mov');
	assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
	assert.equal(args[args.indexOf('-crf') + 1], '18');
	assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
	assert.equal(args[args.indexOf('-b:a') + 1], '256k');
	assert.equal(args.at(-1), '/private/output.mov');
	assert.ok(args.includes('pipe:3'));
	assert.ok(args.includes('pipe:4'));
	const silent = createDesktopExternalFfmpegVideoWorkload({
		...PLAN, audioInputBytes: null, audioRingCapacityBytes: null,
	}, { outputPath: '/private/silent.mov' }).ffmpegArguments;
	assert.ok(silent.includes('-an'));
	assert.equal(silent.includes('pipe:4'), false);
});

test('MOV requires the MOV muxer and compatible FFmpeg codecs, independently of MP4', async () => {
	const available = createDesktopExternalFfmpegVideoCapabilities({ capabilities: CAPABILITIES });
	assert.equal(available.formats.mov.available, true);
	assert.equal(available.formats.mp4.available, false);
	assert.equal(desktopVideoExportCapabilities(available).formats.mov.available, true);
	assert.equal(desktopVideoExportCapabilities({ schemaVersion: 1, formats: {
		mov: { available: true, provider: 'bundled' },
	} }).formats.mov.available, false);
	for (const capabilities of [
		{ ...CAPABILITIES, muxers: ['mp4'] },
		{ ...CAPABILITIES, encoders: ['libx264'] },
		{ ...CAPABILITIES, encoders: ['aac'] },
	]) assert.equal(createDesktopExternalFfmpegVideoCapabilities({ capabilities }).formats.mov.available, false);
	const request = { format: 'mov', canvas: {}, quality: 'high', eligible: true };
	assert.equal((await resolvePlatformVideoDeliveryEncoder({
		isDesktop: true, getDesktopVideoExportCapabilities: () => available,
	}, request)).tier, 'ffmpeg');
	await assert.rejects(resolvePlatformVideoDeliveryEncoder({ isDesktop: true }, request), /FFmpeg/u);
	await assert.rejects(resolvePlatformVideoDeliveryEncoder({ isDesktop: false }, request), /FFmpeg/u);
});

test('MOV accepts finite QuickTime structure in buffered and streamed output and rejects truncation', async () => {
	assert.doesNotThrow(() => assertFiniteVideoKeyframeContainer(MOV, 'mov'));
	const source = {
		statFile: async () => ({ size: MOV.byteLength }),
		readFileRange: async (_path: string, offset: number, length: number) => MOV.slice(offset, offset + length),
	};
	await assertFiniteVideoKeyframeContainerFile(source, '/output.mov', 'mov');
	const chunks: Uint8Array[] = [];
	const result = await streamVideoKeyframeVideoOutput<Buffer>({ source, path: '/output.mov', format: 'mov' }, {
		async open(size) { assert.equal(size, MOV.byteLength); },
		async write(chunk) { chunks.push(chunk.slice()); },
		async close() { return Buffer.concat(chunks); },
		async abort() { assert.fail('Valid MOV output must not abort its save sink.'); },
	});
	assert.deepEqual([...result.output], [...MOV]);
	assert.throws(() => assertFiniteVideoKeyframeContainer(MOV.slice(0, -1), 'mov'), /container/u);
});
