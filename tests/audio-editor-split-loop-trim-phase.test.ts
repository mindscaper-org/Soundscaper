/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { clipLoopUpdateFields, readClipLoop, trimClipLoopPeriod } from '../src/common/editor/audio-clip-loop.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { loopPointerPreview } from '../src/common/editor/ui/timeline/clip-loop-pointer.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { audioRenderCustody } from './helpers/audio-render-custody.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';

const PERIOD = 4800;
const EXTENT = 12_000;
const SPLIT = 650;
const RATE = 48_000;

for (const reversed of [false, true]) for (const edge of ['left', 'right'] as const) {
	test(`the ${edge} trim handle keeps the first retained phrase of a ${reversed ? 'reversed' : 'forward'} split loop`, async context => {
		const { controller, render } = await audioRenderCustody(context);
		const path = await mkdtemp(join(tmpdir(), 'goal-split-loop-trim.'));
		context.after(async () => { await rm(path, { recursive: true }); });
		const input = Float32Array.from({ length: PERIOD }, (_, frame) => 0.2 * Math.sin(2 * Math.PI * 440 * frame / RATE) * (frame + 1) / PERIOD);
		const wav = encodeWav([input], { sampleRate: RATE, float: true }); assert.ok(wav instanceof Uint8Array);
		const wavePath = join(path, 'Asymmetric phrase.wav');
		await writeFile(wavePath, wav);
		await controller.actions.project.importFiles([new File([Uint8Array.from(await readFile(wavePath))],
			'Asymmetric phrase.wav', { type: 'audio/wav' })], { destination: 'timeline' });
		const imported = resolveRuntimeProjectProjection(clipboardProject(controller.project));
		const [clip] = imported.clips; assert.ok(clip?.kind === 'audio');
		const trackId = controller.getSnapshot().selectedTrackId; assert.ok(trackId);
		const loopDrag = loopPointerPreview({ kind: 'clip-loop', clipId: clip.id, trackId, startX: 0, original: clip },
			PERIOD, EXTENT - PERIOD, RATE, RATE);
		assert.ok(loopDrag);
		await controller.actions.clip.update(clip.id, { loop: loopDrag.loopChange, reversed });
		await controller.actions.timeline.setExactSelection(SPLIT, SPLIT, { trackIds: [trackId] });
		controller.actions.transport.seek(SPLIT);
		await controller.actions.edit.split(clip.id);
		const before = clipboardProject(controller.project);
		const tail = resolveRuntimeProjectProjection(before).clips.find(value => value.timelineStartFrame === SPLIT);
		assert.ok(tail?.kind === 'audio');
		assert.deepEqual(readClipLoop(tail), { periodFrames: PERIOD, offsetFrames: SPLIT });
		const original = await render(EXTENT);
		const delta = edge === 'left' ? 300 : -600;
		const periodFrames = PERIOD - Math.abs(delta);
		const offsetFrames = edge === 'left' ? 350 : SPLIT;
		const sourceStartFrame = (edge === 'left') !== reversed ? Math.abs(delta) : 0;
		const preview = loopPointerPreview({ kind: `trim-${edge}`, clipId: tail.id, trackId, startX: 0, original: tail },
			PERIOD, delta, RATE, RATE);
		assert.ok(preview);
		const history = controller.getSnapshot().history.undoEntries.length;
		await controller.actions.clip.trim(tail.id, edge === 'left'
			? { timelineStartFrame: SPLIT + delta, durationFrames: tail.durationFrames - delta }
			: { durationFrames: tail.durationFrames + delta });
		const after = clipboardProject(controller.project);
		const result = resolveRuntimeProjectProjection(after).clips.find(value => value.id === tail.id); assert.ok(result?.kind === 'audio');
		const trimmed = await render(EXTENT);
		const retainedEnd = SPLIT + periodFrames - offsetFrames;
		for (let channel = 0; channel < trimmed.length; channel++) {
			for (let frame = SPLIT + 256; frame < retainedEnd; frame++) {
				const error = Math.abs(trimmed[channel]![frame]! - original[channel]![frame]!);
				assert.ok(error < 1e-6, `leading sample ${frame} of channel ${channel} was still inside the trimmed period`);
			}
		}
		assert.deepEqual(readClipLoop(preview), { periodFrames, offsetFrames });
		assert.deepEqual(readClipLoop(result), readClipLoop(preview));
		assert.deepEqual([result.timelineStartFrame, result.durationFrames, result.sourceStartFrame, result.sourceDurationFrames],
			[SPLIT, EXTENT - SPLIT, sourceStartFrame, periodFrames]);
		assert.deepEqual([preview.durationFrames, preview.sourceStartFrame, preview.sourceDurationFrames],
			[EXTENT - SPLIT, sourceStartFrame, periodFrames]);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		assert.deepEqual(after.sources, before.sources);
		await controller.actions.edit.undo();
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		assertPcmChannelsEqual(await render(EXTENT), original, 'Undo PCM');
		await controller.actions.edit.redo();
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(after));
		assertPcmChannelsEqual(await render(EXTENT), trimmed, 'Redo PCM');
	});
}

test('loop trim begins at the new boundary when its first audible sample was removed', () => {
	const clip = { kind: 'audio', sourceStartFrame: 20, sourceDurationFrames: 100, durationFrames: 400 };
	const looped = { ...clip, ...clipLoopUpdateFields(clip, { periodFrames: 100, offsetFrames: 25 }) };
	assert.equal(trimClipLoopPeriod(looped, 140, 'left', 30).offsetFrames, 0);
	assert.equal(trimClipLoopPeriod(looped, 140, 'right', -80).offsetFrames, 0);
});

test('an extension of a phased loop preserves its audible start and a source-bound cap preserves phase', () => {
	const clip = { kind: 'audio', sourceStartFrame: 20, sourceDurationFrames: 100, durationFrames: 400 };
	const looped = { ...clip, ...clipLoopUpdateFields(clip, { periodFrames: 100, offsetFrames: 25 }) };
	assert.deepEqual(trimClipLoopPeriod(looped, 120, 'left', -10), {
		periodFrames: 110, offsetFrames: 35, sourceStartFrame: 10, sourceDurationFrames: 110,
	});
	assert.deepEqual(trimClipLoopPeriod(looped, 120, 'right', 10), {
		periodFrames: 100, offsetFrames: 25, sourceStartFrame: 20, sourceDurationFrames: 100,
	});
});
