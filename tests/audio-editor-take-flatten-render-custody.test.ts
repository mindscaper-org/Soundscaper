/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { audioRenderCustody, independentlyHashPcm } from './helpers/audio-render-custody.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertAudioProjectArchivePcm, readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

const FRAMES = 12_000;
function assertOriginalProgramme(actual: readonly Float32Array[], expected: Float32Array, label: string) {
	assert.equal(actual.length, 2);
	for (const [channelIndex, channel] of actual.entries()) {
		assert.equal(channel.length, FRAMES);
		for (let frame = 0; frame < FRAMES; frame++) {
			if (!(Math.abs(channel[frame]! - expected[frame]!) < .0001))
				assert.fail(`${label} channel${channelIndex}/frame${frame}: ${channel[frame]} versus ${expected[frame]}`);
		}
	}
}

for (const microfades of [true, false]) test(`actual Flatten comp retains all original Float32 endpoints with new-clip fades ${microfades}`, { timeout: 30_000 }, async context => {
	const custody = await audioRenderCustody(context), { controller, store, native, playback } = custody;
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: FRAMES, channelCount: 2 });
	const project = createSoundscaperProject({ id: `take-fades-${microfades}`, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main', trackIds: ['voice'] }], primarySequenceId: 'main',
		takeGroups: [{ id: 'comp', sequenceId: 'main', trackId: 'voice', startSample: 0, endSample: FRAMES,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: source.id, startSample: 0, endSample: FRAMES, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: FRAMES }] }],
	});
	const pcm = Float32Array.from({ length: FRAMES }, (_, frame) => .25 * Math.sin(2 * Math.PI * 1000 * frame / 48_000));
	await custody.open(project, new Map([[source.id, [pcm, pcm]]]));
	await controller.actions.preferences.update({ editing: { applyMicrofadesToNewClips: microfades } });
	const preferences = controller.getSnapshot().preferences;
	assert.ok(preferences && typeof preferences === 'object' && 'editing' in preferences);
	assert.ok(preferences.editing && typeof preferences.editing === 'object' && 'applyMicrofadesToNewClips' in preferences.editing);
	assert.equal(preferences.editing.applyMicrofadesToNewClips, microfades);
	const before = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
	const contexts = native.snapshot().offlineContexts;
	await controller.actions.takeComp.flatten('comp');
	assert.equal(native.snapshot().offlineContexts, contexts + 1, 'actual SDK rendered the exact original comp');
	const flattened = clipboardProject(controller.project), clip = flattened.clips[0]; assert.ok(clip?.kind === 'audio');
	const rendered = flattened.sources.find(value => value.id === clip.sourceId); assert.ok(rendered?.kind === 'audio');
	assert.equal(flattened.takeGroups.length, 0); assert.equal(flattened.clips.length, 1);
	assert.equal(flattened.tracks.length, before.tracks.length); assert.deepEqual(flattened.tracks[0]!.clipIds, [clip.id]);
	assert.notEqual(rendered.id, source.id);
	assert.deepEqual([rendered.frameCount, rendered.channelCount, rendered.sampleRate, rendered.chunkFrames, rendered.sampleFormat], [FRAMES, 2, 48_000, 65_536, 'float32']);
	assert.deepEqual([clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames, clip.sourceDurationFrames,
		clip.fadeInFrames, clip.fadeOutFrames, clip.gain], [0, 0, FRAMES, FRAMES, 0, 0, 1]);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	const published = await readCustodyPcm(store, rendered);
	assertOriginalProgramme(published, pcm, 'persisted Flatten comp');
	assert.equal(await playback.hashSourceContent(flattened.id, rendered), independentlyHashPcm(published));
	assertOriginalProgramme(await custody.render(FRAMES), pcm, 'actual audible Flatten comp');
	controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	assertPcmChannelsEqual(await readCustodyPcm(store, source), [pcm, pcm], 'original take source after Undo');
	controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(flattened));
	assertOriginalProgramme(await custody.render(FRAMES), pcm, 'actual audible Flatten Redo');
	await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(flattened.id), controller.project);
	assert.deepEqual(await store.loadSetting('soundscaper:audio-editor-preferences-v1'), preferences);
	await assertAudioProjectArchivePcm(context, store, controller.project, (_name, channels) => { assertOriginalProgramme(channels, pcm, 'independent Scape source'); });
	assert.ok(native.snapshot().worklets.every(worklet => worklet.processorErrors.length === 0));
});
