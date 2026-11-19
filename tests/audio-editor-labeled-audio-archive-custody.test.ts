/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav } from '../src/common/editor/wav.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { assertEditedAudioArchiveCustody } from './helpers/edited-audio-archive-custody.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';

for (const musical of [false, true]) test(`labeled audio ${musical ? 'beat' : 'sample'} boundaries retain exact edits and original PCM through controller and Scape`, async context => {
	const archive = createSoundscaperScapeNativeRuntime();
	const { controller, store } = await controllerSession(context, { scapeProjectRuntime: archive,
		engineFactory: () => { throw new Error('Label boundary splitting must retain source PCM without rendering a substitute.'); } });
	const label = { id: 'span', title: 'Middle', ...(musical
		? { anchor: 'musical', startBeat: { num: 1, den: 1 }, endBeat: { num: 2, den: 1 } }
		: { startFrame: 24_000, endFrame: 48_000 }) };
	const project = createSoundscaperProject({ id: `label-custody-${musical}`, sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ id: 'origin', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		tracks: [{ id: 'labels', type: 'label', name: 'Cues', labels: [label] }] });
	const original = await archive.exportScapeProject(project, store); assert.ok(original.blob);
	await controller.actions.project.openScapeFile(new File([original.blob], 'Labeled.sscape'), () => 'copy');
	const pcm = [330, 550].map((frequency, channel) => Float32Array.from({ length: 96_000 }, (_, frame) =>
		(channel ? .125 : .25) * Math.sin(2 * Math.PI * frequency * frame / 48_000)));
	await controller.actions.project.importFiles([new File([Uint8Array.from(encodeWav(pcm, { sampleRate: 48_000, bitDepth: 32, float: true }))], 'label-bed.wav', { type: 'audio/wav' })]);
	const imported: unknown = controller.project; assert.ok(validateSoundscaperProject(imported));
	assert.equal(imported.clips.length, 1);
	controller.actions.timeline.setExactSelection(0, 96_000, { trackIds: imported.tracks.map(track => track.id) });
	const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
	await controller.actions.edit.labeledSplit();
	const edited: unknown = controller.project; assert.ok(validateSoundscaperProject(edited));
	const expected = [[0, 24_000, 0], [24_000, 24_000, 24_000], [48_000, 48_000, 48_000]];
	assert.deepEqual(geometry(edited), expected);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, edited.clips);
	await controller.actions.project.flush();
	const reopened = await assertEditedAudioArchiveCustody(context, store, controller.project, pcm);
	assert.deepEqual(geometry(reopened), expected);
	assert.deepEqual(reopened.tracks.find(track => track.id === 'labels'), before.tracks.find(track => track.id === 'labels'));

	function geometry(value: unknown) {
		assert.ok(validateSoundscaperProject(value));
		return value.clips.map(clip => {
			assert.ok(clip.kind === 'audio');
			const start = clip.timelineStartFrame, duration = clip.durationFrames, sourceStart = clip.sourceStartFrame;
			assert.ok(typeof start === 'number' && typeof duration === 'number' && typeof sourceStart === 'number');
			return [start, duration, sourceStart] as const;
		})
			.sort((left, right) => left[0] - right[0]);
	}
});
