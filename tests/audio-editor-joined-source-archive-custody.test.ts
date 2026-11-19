/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { canJoinClips } from '../src/common/editor/commands/clip-link-runtime.js';
import { clipboardDocument, clipboardPcm, clipboardProject, createClipboardCustody } from './helpers/clipboard-source-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

for (const reversed of [false, true]) test(`Join preserves exact independently trimmed ${reversed ? 'reversed' : 'ordinary'} source custody through history and fresh Scape`, async context => {
	const f = await createClipboardCustody(context), { controller } = f;
	await controller.actions.preferences.update({ editing: { applyMicrofadesToNewClips: false } });
	const source = createAudioSource({ id: 'recording', name: 'Trimmed.wav', sampleRate: 48_000, frameCount: 100_000, channelCount: 2 });
	const pcm = [clipboardPcm(100_000), clipboardPcm(100_000, 1)];
	const clips = [0, 1].map(index => {
		const start = reversed ? 50_000 - index * 10_000 : 40_000 + index * 10_000;
		return createAudioClip({ id: `part-${index}`, sourceId: source.id, timelineStartFrame: index * 10_000, durationFrames: 10_000,
			sourceStartFrame: start, sourceDurationFrames: 10_000, trimStartFrames: start, trimEndFrames: 90_000 - start, reversed });
	});
	await f.open(createSoundscaperProject({ id: `trimmed-join-${reversed}`, sources: [source], clips,
		tracks: [createAudioTrack({ id: 'voice', clipIds: clips.map(clip => clip.id) })],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: clips.map(clip => clip.id) } }), new Map([[source.id, pcm]]));
	const before = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
	await controller.actions.edit.join();
	const edited = clipboardProject(controller.project), joined = resolveRuntimeProjectProjection(edited).clips[0]; assert.ok(joined?.kind === 'audio');
	assert.equal(edited.clips.length, 1); assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	assert.deepEqual([joined.sourceId, joined.timelineStartFrame, joined.durationFrames, joined.sourceStartFrame, joined.sourceDurationFrames,
		joined.trimStartFrames, joined.trimEndFrames, joined.reversed], ['recording', 0, 20_000, 40_000, 20_000, 40_000, 40_000, reversed]);
	assert.deepEqual(edited.sources, before.sources); assert.deepEqual(edited.tracks[0]?.clipIds, [joined.id]);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	await f.archive((_name, actual) => assertPcmChannelsEqual(actual, pcm));
});

for (const anchor of ['sample', 'musical'] as const) for (const unequal of [false, true])
	test(`${anchor} Join admits equal source traversal and atomically refuses unequal=${unequal} through native archive custody`, async context => {
		const f = await createClipboardCustody(context), { controller } = f;
		await controller.actions.preferences.update({ editing: { applyMicrofadesToNewClips: false } });
		const source = createAudioSource({ id: 'recording', name: 'Musical.wav', sampleRate: 48_000, frameCount: 96_000, channelCount: 2 });
		const pcm = [clipboardPcm(96_000), clipboardPcm(96_000, 1)];
		const clips = [0, 1].map(index => createAudioClip({ id: `part-${index}`, sourceId: source.id, anchor,
			sourceStartFrame: index * 48_000, sourceDurationFrames: 48_000,
			...(anchor === 'sample' ? { timelineStartFrame: index * 48_000, durationFrames: unequal && index ? 24_000 : 48_000 }
				: { musicalStartBeat: index * 2, musicalDurationBeats: unequal && index ? 1 : 2, musicalExtent: 'beat' }) }));
		await f.open(createSoundscaperProject({ id: `ratio-${anchor}-${unequal}`, sources: [source], clips,
			tracks: [createAudioTrack({ id: 'voice', clipIds: clips.map(clip => clip.id) })],
			selection: { startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: clips.map(clip => clip.id) } }), new Map([[source.id, pcm]]));
		const before = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
		assert.equal(canJoinClips(before, clips.map(clip => clip.id)), !unequal);
		await controller.actions.edit.join();
		const edited = clipboardProject(controller.project);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + (unequal ? 0 : 1));
		if (unequal) assert.deepEqual(edited, before);
		else {
			const joined = resolveRuntimeProjectProjection(edited).clips[0]; assert.ok(joined?.kind === 'audio');
			assert.equal(edited.clips.length, 1);
			assert.deepEqual([joined.sourceId, joined.timelineStartFrame, joined.durationFrames, joined.sourceStartFrame, joined.sourceDurationFrames],
				['recording', 0, 96_000, 0, 96_000]);
			await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
			await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
		}
		await f.archive((_name, actual) => assertPcmChannelsEqual(actual, pcm));
	});
