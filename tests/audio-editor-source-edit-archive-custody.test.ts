/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { normalizeAudioWarpMap } from '../src/common/editor/audio-warp-domain.ts';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { clipboardDocument, clipboardPcm, clipboardProject, createClipboardCustody } from './helpers/clipboard-source-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

async function seed(context: TestContext, frames = 48_000, channels = [clipboardPcm(frames), clipboardPcm(frames, 1)], loop = false) {
	const f = await createClipboardCustody(context), source = createAudioSource({ id: 'recording', name: 'Source.wav', sampleRate: 48_000, frameCount: frames, channelCount: channels.length });
	await f.open(createSoundscaperProject({ id: context.name, sources: [source], tracks: [createAudioTrack({ id: 'voice', clipIds: ['phrase'] })],
		clips: [createAudioClip({ id: 'phrase', sourceId: source.id, durationFrames: frames, sourceDurationFrames: frames })] }), new Map([[source.id, channels]]));
	await f.controller.actions.timeline.selectClip('phrase');
	if (loop) await f.controller.actions.clip.update('phrase', { loop: { periodFrames: frames, durationFrames: frames * 2 } });
	return { ...f, source, channels };
}

function clip(project: unknown) { const value = resolveRuntimeProjectProjection(clipboardProject(project)).clips[0]; assert.ok(value?.kind === 'audio'); return value; }
function warpCoordinates(value: unknown) { return normalizeAudioWarpMap(value).points.map(point => [point.outer.num / point.outer.den, point.source.num / point.source.den]); }

for (const warped of [false, true]) test(`${warped ? 'nonlinear' : 'ordinary'} Source Monitor trim preserves independent source/timeline windows, history and exact archive PCM`, async context => {
	const f = await seed(context), { controller } = f;
	if (warped) { await controller.actions.audioWarp.createIdentityMap(); await controller.actions.audioWarp.addMarker({ outer: 24_000, source: 36_000 }); }
	const before = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries.length;
	if (warped) assert.deepEqual(warpCoordinates(clip(before).warpMap), [[0, 0], [24_000, 36_000], [48_000, 48_000]]);
	await controller.actions.clipSourcePreview.trim('phrase', { sourceStartFrame: 0, sourceDurationFrames: 43_200, durationFrames: warped ? 38_400 : 43_200 });
	const edited = clipboardProject(controller.project), result = clip(edited);
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
	assert.deepEqual([result.timelineStartFrame, result.sourceStartFrame, result.sourceDurationFrames, result.durationFrames, result.trimStartFrames, result.trimEndFrames],
		[0, 0, 43_200, warped ? 38_400 : 43_200, 0, 4800]);
	assert.deepEqual(edited.sources, before.sources);
	if (warped) assert.deepEqual(warpCoordinates(result.warpMap), [[0, 0], [24_000, 36_000], [38_400, 43_200]]);
	else assert.equal(result.warpMap, null);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	await f.archive((_name, actual) => assertPcmChannelsEqual(actual, f.channels));
});

test('loop duration edits preserve the source period and a split within the first repeat rejoins through history and Scape', async context => {
	const f = await seed(context, 38_400, undefined, true), { controller } = f;
	await controller.actions.preferences.update({ editing: { applyMicrofadesToNewClips: false } });
	const before = clipboardProject(controller.project);
	await controller.actions.clip.update('phrase', { loop: { periodFrames: 38_400, durationFrames: 57_600 } });
	assert.deepEqual(readClipLoop(clip(controller.project)), { periodFrames: 38_400, offsetFrames: 0 });
	assert.deepEqual([clip(controller.project).sourceDurationFrames, clip(controller.project).durationFrames], [38_400, 57_600]);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	await controller.actions.timeline.setExactSelection(19_200, 19_200, { trackIds: ['voice'] }); await controller.actions.transport.seek(19_200);
	await controller.actions.edit.split();
	const split = clipboardProject(controller.project); assert.equal(split.clips.length, 2);
	await controller.actions.timeline.selectClip(split.clips[0]!.id); await controller.actions.timeline.selectClip(split.clips[1]!.id, { additive: true });
	await controller.actions.edit.join();
	const joined = clipboardProject(controller.project); assert.equal(joined.clips.length, 1);
	assert.deepEqual(readClipLoop(clip(joined)), { periodFrames: 38_400, offsetFrames: 0 });
	assert.deepEqual([clip(joined).timelineStartFrame, clip(joined).durationFrames, clip(joined).sourceStartFrame, clip(joined).sourceDurationFrames], [0, 76_800, 0, 38_400]);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(split));
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	await controller.actions.edit.redo(); await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(joined));
	await f.archive((_name, actual) => assertPcmChannelsEqual(actual, f.channels));
});

for (const entry of ['track', 'selection'] as const) test(`${entry} Duplicate preserves locked source ownership and the exact native history reset through fresh Scape`, async context => {
	const f = await seed(context, 38_400), { controller } = f, before = clipboardProject(controller.project);
	const duplicate = async () => {
		await controller.actions.timeline.selectClip('phrase');
		if (entry === 'track') await controller.actions.track.duplicate('voice'); else await controller.actions.edit.duplicate();
	};
	await duplicate(); assert.equal(controller.project?.clips.length, 2);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	await controller.actions.track.update('voice', { locked: true });
	const locked = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries.length;
	await duplicate();
	const copied = clipboardProject(controller.project), destination = copied.tracks.find(track => track.id !== 'voice'); assert.ok(destination?.type === 'audio');
	assert.equal(copied.sources.length, 1); assert.equal(copied.clips.length, 2); assert.equal(copied.tracks.length, 2);
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
	assert.ok(copied.tracks.every(track => track.type === 'audio' && track.locked));
	assert.equal(new Set(copied.clips.map(value => value.id)).size, 2);
	assert.deepEqual(resolveRuntimeProjectProjection(copied).clips.map(value => [value.sourceId, value.timelineStartFrame, value.sourceStartFrame, value.durationFrames, value.sourceDurationFrames]),
		[['recording', 0, 0, 38_400, 38_400], ['recording', 0, 0, 38_400, 38_400]]);
	await controller.actions.track.update(destination.id, { locked: false });
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(copied));
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(locked));
	await controller.actions.edit.redo(); await controller.actions.track.update('voice', { locked: false });
	const edited = clipboardProject(controller.project);
	assert.equal(edited.tracks.find(track => track.id === 'voice')?.locked, false); assert.equal(edited.tracks.find(track => track.id === destination.id)?.locked, true);
	for (let step = 0; step < 3; step++) await controller.actions.edit.undo();
	assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before), 'three native Undo actions restore the shared browser source baseline');
	for (let step = 0; step < 3; step++) await controller.actions.edit.redo();
	assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	await f.archive((_name, actual) => assertPcmChannelsEqual(actual, f.channels));
});
