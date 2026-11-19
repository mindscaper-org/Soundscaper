/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportPlan } from '../src/common/editor/export.js';
import { wrapLoopRender } from '../src/common/editor/export-loop.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { readLoopPcmSpool } from '../src/common/editor/controller/export/internal/audio/loop-pcm-spool.ts';
import { encodeRealtimePcmSpoolChunk } from '../src/common/editor/controller/export/internal/audio/realtime-pcm-spool.ts';
import { resolveRenderPreRollFrames } from '../src/common/editor/engine/rendering-range.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createDeliveryReportForPlan } from '../src/common/editor/delivery-conversion-inventory.ts';

const sampleRate = 48_000;
function loopProject() {
	return createSoundscaperProject({ sampleRate,
		sources: [createAudioSource({ id: 'source', frameCount: sampleRate, channelCount: 2, sampleRate })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: sampleRate, sourceDurationFrames: sampleRate })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'], effects: [
			createEffect('delay', { params: { time: .25, feedback: 0, mix: 1 } }),
		] })], loop: { enabled: true, startFrame: 12_000, endFrame: 24_000 },
	});
}

test('fresh exports disable dither, appended tails and loop rendering', () => {
	const project = loopProject();
	const settings = createExportDialogInitialSettings(project);
	assert.equal(settings.dither, 'none');
	assert.equal(settings.includeTail, false);
	assert.equal(settings.renderAsLoop, false);
	const plan = createExportPlan(project, { range: 'loop' });
	assert.equal(plan.encoding.dither, 'none');
	assert.equal(plan.tailFrames, 0);
	assert.equal(plan.outputFrames, 12_000);
});

test('a loop plan budgets its rendered tail but delivers exactly the In/Out duration', () => {
	const project = loopProject();
	for (const includeTail of [false, true]) {
		const plan = createExportPlan(project, { range: 'loop', renderAsLoop: true, includeTail, sampleRate: 96_000 });
		assert.equal(plan.renderAsLoop, true);
		assert.equal(plan.tailFrames, 12_000);
		assert.equal(plan.outputFrames, 24_000);
		assert.ok(createDeliveryReportForPlan(plan, { sampleRate }).items.some(item => item.code === 'delivery.loop-wrap'));
		assert.equal(plan.outputFileBytesPerRender, createExportPlan(project, { range: 'loop', sampleRate: 96_000 }).outputFileBytesPerRender);
	}
	assert.throws(() => createExportPlan(project, { renderAsLoop: true }), /loop/iu);
	assert.throws(() => createExportPlan(project, { range: 'loop', mode: 'clips', renderAsLoop: true }), /loop/iu);
});

test('isolated loop renders exclude the effect history of audio before In', () => {
	assert.equal(resolveRenderPreRollFrames(loopProject(), 12_000, false), 0);
	assert.equal(resolveRenderPreRollFrames(loopProject(), 12_000, 0), 12_000);
});

test('wrap remainder sums multichannel tails repeatedly without extending or clipping the loop', () => {
	const rendered = wrapLoopRender([Float32Array.of(1, 2, 3, 4, 5, 6), Float32Array.of(-1, -2, -3, -4, -5, -6)], 2, sampleRate);
	assert.equal(rendered.length, 2);
	assert.equal(rendered.sampleRate, sampleRate);
	assert.deepEqual(Array.from(rendered.getChannelData(0)), [9, 12]);
	assert.deepEqual(Array.from(rendered.getChannelData(1)), [-9, -12]);
	assert.throws(() => wrapLoopRender([new Float32Array(1)], 2, sampleRate), /loop/iu);
});

for (const loopFrames of [2, 20_000]) test(`streamed wrapping matches offline PCM for a ${loopFrames}-frame loop`, async () => {
	const frames = loopFrames * 3 + 3;
	const left = Float32Array.from({ length: frames }, (_, index) => (index % 8) / 8);
	const right = Float32Array.from(left, sample => -sample);
	const parts: Uint8Array<ArrayBuffer>[] = [];
	for (let offset = 0; offset < frames; offset += 4096) {
		parts.push(new Uint8Array(encodeRealtimePcmSpoolChunk([left.subarray(offset, offset + 4096), right.subarray(offset, offset + 4096)])));
	}
	const actual = [[], []] as number[][];
	for await (const chunk of readLoopPcmSpool(new Blob(parts), 2, loopFrames, () => undefined)) {
		assert.ok(chunk[0]!.length <= 16_384);
		chunk.forEach((channel, index) => actual[index]!.push(...channel));
	}
	const expected = wrapLoopRender([left, right], loopFrames, sampleRate);
	assert.deepEqual(actual, expected.channels.map(channel => Array.from(channel)));
});

test('streamed loop wrapping honors cancellation before reading PCM', async () => {
	const cancellation = new DOMException('Cancelled', 'AbortError');
	const reader = readLoopPcmSpool(new Blob([new Uint8Array(8)]), 1, 1, () => { throw cancellation; });
	await assert.rejects(reader.next(), error => error === cancellation);
});
