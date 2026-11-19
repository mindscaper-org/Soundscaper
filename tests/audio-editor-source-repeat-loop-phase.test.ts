/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { clipSourceSelection } from '../src/common/editor/ui/inspector/clip-source-selection.ts';
import { loopPointerPreview } from '../src/common/editor/ui/timeline/clip-loop-pointer.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { audioRenderCustody } from './helpers/audio-render-custody.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';

const PERIOD = 4_800;
const SPLIT = 650;
const RATE = 48_000;
const SELECTION_START = 1600;
const SELECTION_END = 2320;
const ADDED = SELECTION_END - SELECTION_START;

for (const [reversed, extent, end] of [
	[false, 12_000, 14_160],
	[true, 12_000, 13_440],
	[false, 11_600, 13_440],
	[false, 9600, 11_040],
] as const) {
	test(`source Repeat preserves the first and last audible boundaries, reversed=${String(reversed)} extent=${extent}`, async context => {
		const { controller, render, store } = await audioRenderCustody(context);
		const scratch = await mkdtemp(join(tmpdir(), 'goal-repeat-source-loop.'));
		context.after(async () => { await rm(scratch, { recursive: true }); });
		const input = Float32Array.from({ length: PERIOD }, (_, frame) => 0.2 * Math.sin(2 * Math.PI * 440 * frame / RATE) * (frame + 1) / PERIOD);
		const wav = encodeWav([input], { sampleRate: RATE, float: true }); assert.ok(wav instanceof Uint8Array);
		const path = join(scratch, 'Asymmetric phrase.wav');
		await writeFile(path, wav);
		await controller.actions.project.importFiles([new File([Uint8Array.from(await readFile(path))],
			'Asymmetric phrase.wav', { type: 'audio/wav' })], { destination: 'timeline' });
		const initial = resolveRuntimeProjectProjection(clipboardProject(controller.project));
		const [clip] = initial.clips; assert.ok(clip?.kind === 'audio');
		const trackId = controller.getSnapshot().selectedTrackId; assert.ok(trackId);
		const loopDrag = loopPointerPreview({ kind: 'clip-loop', clipId: clip.id, trackId, startX: 0, original: clip },
			PERIOD, extent - PERIOD, RATE, RATE);
		assert.ok(loopDrag);
		await controller.actions.clip.update(clip.id, { loop: loopDrag.loopChange, reversed });
		await controller.actions.timeline.setExactSelection(SPLIT, SPLIT, { trackIds: [trackId] });
		controller.actions.transport.seek(SPLIT);
		await controller.actions.edit.split(clip.id);
		const before = clipboardProject(controller.project), projected = resolveRuntimeProjectProjection(before);
		const tail = projected.clips.find(value => value.timelineStartFrame === SPLIT);
		assert.ok(tail?.kind === 'audio');
		assert.deepEqual(readClipLoop(tail), { periodFrames: PERIOD, offsetFrames: SPLIT });
		const media = projected.sources.find(value => value.id === tail.sourceId); assert.ok(media?.kind === 'audio');
		const firstEdited = reversed ? PERIOD - SELECTION_END : SELECTION_START;
		const selection = clipSourceSelection(projected, tail, media, {
			startFrame: firstEdited - SPLIT, endFrame: firstEdited - SPLIT + ADDED,
		});
		assert.deepEqual(selection.source, { startFrame: SELECTION_START, endFrame: SELECTION_END });
		const original = await render(extent);
		controller.actions.clipSourcePreview.focus(tail.id);
		controller.actions.clipSourcePreview.setSelection(selection.display);
		controller.actions.effects.setSourceSelection({ clipId: tail.id, ...selection.source });
		const history = controller.getSnapshot().history.undoEntries.length;
		await controller.actions.effects.applySelection({ type: 'audacity-repeat', params: { count: 1 } });
		const after = clipboardProject(controller.project);
		const edited = resolveRuntimeProjectProjection(after).clips.find(value => value.id === tail.id);
		assert.ok(edited?.kind === 'audio');
		const output = await render(end);
		assertPcmChannelsEqual(output.map(channel => channel.slice(SPLIT + 256, firstEdited)),
			original.map(channel => channel.slice(SPLIT + 256, firstEdited)), 'untouched leading phrase');
		assert.deepEqual(readClipLoop(edited), { periodFrames: PERIOD + ADDED, offsetFrames: SPLIT });
		assert.deepEqual([edited.timelineStartFrame, edited.durationFrames, edited.sourceStartFrame, edited.sourceDurationFrames],
			[SPLIT, end - SPLIT, 0, PERIOD + ADDED]);
		const derived = after.sources.find(value => value.id === edited.sourceId); assert.ok(derived?.kind === 'audio');
		assert.notEqual(derived.id, media.id);
		const expected = new Float32Array(PERIOD + ADDED);
		expected.set(input.subarray(0, SELECTION_END));
		expected.set(input.subarray(SELECTION_START), SELECTION_END);
		assertPcmChannelsEqual(await readCustodyPcm(store, derived), [expected], 'stored Repeat effect PCM');
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		await controller.actions.edit.undo();
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		assertPcmChannelsEqual(await render(extent), original, 'Undo PCM');
		await controller.actions.edit.redo();
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(after));
		assertPcmChannelsEqual(await render(end), output, 'Redo PCM');
	});
}
