/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudacityEffectMacro } from '../src/common/editor/effect-macros.js';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertMacroPcm, independentlyFaded, macroDspCustody, macroRecording } from './helpers/macro-dsp-custody.ts';

const FRAMES = 48_000, DUCK_GAIN = 10 ** (-12 / 20);
const NATIVE_TEXT = 'AutoDuck:DuckAmountDb="-12" InnerFadeDownLen="0" InnerFadeUpLen="0" OuterFadeDownLen="0.01" OuterFadeUpLen="0.01" ThresholdDb="-30" MaximumPause="0.1"\n';

function musicCoefficient(samples: Float32Array) {
	let sum = 0;
	for (let frame = 14_400; frame < 33_600; frame++) sum += samples[frame]! * Math.sin(2 * Math.PI * 440 * frame / 48_000);
	return sum;
}

for (const precedingSilent of [false, true]) test(`real imported AutoDuck uses Voice below Music; preceding silent=${precedingSilent}`, { timeout: 30_000 }, async context => {
	const custody = await macroDspCustody(context);
	try {
		const { controller, store, factory } = custody;
		const starter = clipboardProject(controller.project).tracks[0]; assert.ok(starter);
		controller.actions.track.remove(starter.id);
		assert.equal(clipboardProject(controller.project).tracks.length, 0);
		const music = macroRecording('Music.wav', 440, FRAMES, 1, .2), voice = macroRecording('Voice.wav', 880, FRAMES, 1, .5);
		const recordings = [...precedingSilent ? [macroRecording('Silent.wav', 220, FRAMES, 1, 0)] : [], music, voice];
		await controller.actions.project.importFiles(recordings.map(recording => recording.file));
		const imported = clipboardProject(controller.project);
		assert.deepEqual([imported.clips.length, imported.tracks.length], [recordings.length, recordings.length]);
		for (const [index, source] of imported.sources.entries()) await custody.source(source, recordings[index]!.pcm);
		const musicSource = imported.sources.find(source => source.name === 'Music.wav'), voiceSource = imported.sources.find(source => source.name === 'Voice.wav');
		assert.ok(musicSource && voiceSource);
		const musicClip = imported.clips.find(clip => clip.kind === 'audio' && clip.sourceId === musicSource.id);
		const voiceClip = imported.clips.find(clip => clip.kind === 'audio' && clip.sourceId === voiceSource.id);
		assert.ok(musicClip?.kind === 'audio' && voiceClip?.kind === 'audio');
		const musicTrack = imported.tracks.find(track => track.type === 'audio' && track.clipIds.includes(musicClip.id)); assert.ok(musicTrack);
		const voiceTrack = imported.tracks.find(track => track.type === 'audio' && track.clipIds.includes(voiceClip.id)); assert.ok(voiceTrack);
		assert.equal(imported.tracks.indexOf(voiceTrack), imported.tracks.indexOf(musicTrack) + 1);
		controller.actions.timeline.selectClip(musicClip.id); controller.actions.timeline.selectTrackStartToEnd();
		controller.actions.timeline.selectNoTracks();
		controller.actions.timeline.setSelection(0, FRAMES, { trackIds: [musicTrack.id], clipIds: [] });
		const baseline = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
		assert.deepEqual([baseline.selection.startFrame, baseline.selection.endFrame, baseline.selection.trackIds, baseline.selection.clipIds], [0, FRAMES, [musicTrack.id], []]);
		const before = await custody.render(FRAMES), musicProgramme = independentlyFaded(music.pcm)[0]!, voiceProgramme = independentlyFaded(voice.pcm)[0]!;
		const independentBefore = Array.from({ length: 2 }, () => Float32Array.from(musicProgramme, (sample, frame) => (sample + voiceProgramme[frame]!) * Math.SQRT1_2));
		assertMacroPcm(before, independentBefore, 'independent original music and unselected Voice', .7);
		const macro = parseAudacityEffectMacro(NATIVE_TEXT);
		assert.deepEqual(macro.effects[0]?.context, { audacityControlTrackPolicy: 'below-last-selected-audio' });
		await assert.doesNotReject(controller.actions.macros.run({ name: 'Native duck', effects: macro.effects }));
		const changed = clipboardProject(controller.project), changedTrack = changed.tracks.find(track => track.id === musicTrack.id); assert.ok(changedTrack?.type === 'audio');
		const printedClip = changed.clips.find(clip => changedTrack.clipIds.includes(clip.id)); assert.ok(printedClip?.kind === 'audio');
		const printedSource = changed.sources.find(source => source.id === printedClip.sourceId); assert.ok(printedSource?.kind === 'audio');
		assert.notEqual(printedSource.id, musicClip.sourceId);
		assert.deepEqual([printedSource.frameCount, printedSource.channelCount, printedClip.timelineStartFrame,
			printedClip.sourceStartFrame, printedClip.durationFrames, printedClip.fadeInFrames, printedClip.fadeOutFrames], [FRAMES, 1, 0, 0, FRAMES, 0, 0]);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		assert.deepEqual(changed.tracks.find(track => track.id === voiceTrack.id), voiceTrack);
		assert.deepEqual(changed.clips.find(clip => clip.id === voiceClip.id), voiceClip);
		const printed = await readCustodyPcm(store, printedSource); assert.equal(printed.length, 1);
		const programme = printed[0]!; assert.equal(programme.length, FRAMES);
		// A continuous control above threshold must hold -12dB throughout the interior.
		// At the two authored fades, attenuation stays between unity and that floor.
		for (let frame = 0; frame < FRAMES; frame++) {
			const sample = musicProgramme[frame]!, expected = sample * DUCK_GAIN;
			if (frame >= 1024 && frame < FRAMES - 1024) assert.ok(Math.abs(programme[frame]! - expected) < 1e-6, `independent duck plateau/frame${frame}`);
			else {
				assert.ok(Math.abs(programme[frame]!) <= Math.abs(sample) + .2 * .0011 + 1e-6, `duck cannot amplify/frame${frame}`);
				assert.ok(Math.abs(programme[frame]!) >= Math.abs(expected) - .2 * .0011 - 1e-6, `duck floor/frame${frame}`);
				assert.ok(programme[frame]! * sample >= -1e-10, `duck retains polarity/frame${frame}`);
			}
		}
		const after = await custody.render(FRAMES);
		assert.ok(Math.abs(musicCoefficient(after[0]!) / musicCoefficient(before[0]!) - DUCK_GAIN) < 1e-5, 'independent authored 440Hz programme attenuation');
		const expected = Array.from({ length: 2 }, () => Float32Array.from(programme, (sample, frame) => (sample + voiceProgramme[frame]!) * Math.SQRT1_2));
		assertMacroPcm(after, expected, 'full printed source and untouched control delivery', .5);
		await custody.history(baseline, changed, before, after);
		for (const [index, source] of imported.sources.entries()) await custody.source(source, recordings[index]!.pcm);
		assert.equal(factory.snapshot().worklets.filter(worklet => worklet.processorType === 'audacity-auto-duck').length, 1);
		await custody.assertPrograms([], []);
	} finally { await custody.dispose(); }
});
