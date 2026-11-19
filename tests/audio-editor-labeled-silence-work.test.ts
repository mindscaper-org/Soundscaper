/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav } from '../src/common/editor/wav.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';

test('Silence labeled audio stores only the occupied duration for each channel width', async context => {
	const sampleRate = 48_000;
	const monoFrames = 48_000;
	const stereoFrames = 480;
	const archive = createSoundscaperScapeNativeRuntime();
	const { controller, store } = await controllerSession(context, { scapeProjectRuntime: archive });
	const project = createSoundscaperProject({ id: 'mixed-width-silence', sampleRate,
		tracks: [{ id: 'labels', type: 'label', labels: [{ id: 'whole', startFrame: 0, endFrame: monoFrames }] }] });
	const original = await archive.exportScapeProject(project, store);
	assert.ok(original.blob);
	await controller.actions.project.openScapeFile(new File([original.blob], 'Mixed widths.sscape'), () => 'copy');
	await controller.actions.project.importFiles([wav('long-mono', monoFrames, 1), wav('short-stereo', stereoFrames, 2)]);
	const before: unknown = controller.project;
	assert.ok(validateSoundscaperProject(before));
	assert.deepEqual(before.sources.map(source => source.channelCount), [1, 2]);
	controller.actions.timeline.setExactSelection(0, monoFrames, { trackIds: before.tracks.map(track => track.id) });
	assert.equal(await controller.actions.edit.labeledSilence(), true);
	await controller.actions.project.flush();

	const edited: unknown = await store.loadProject(before.id);
	assert.ok(validateSoundscaperProject(edited));
	const priorSourceIds = new Set(before.sources.map(source => source.id));
	const generated = edited.sources.filter(source => !priorSourceIds.has(source.id));
	assert.deepEqual(edited.clips.map(clip => [clip.timelineStartFrame, clip.durationFrames]), [[0, monoFrames], [0, stereoFrames]]);
	assert.deepEqual(generated.map(source => [source.channelCount, source.frameCount]), [[1, monoFrames + 1], [2, stereoFrames + 1]]);
	for (const source of generated) {
		assert.ok(source.kind === 'audio');
		let frames = 0;
		for await (const chunk of store.readSourceChunks(source.storageKey)) {
			assert.equal(chunk.channels.length, source.channelCount);
			for (const channel of chunk.channels) assert.ok(channel.every(sample => sample === 0));
			frames += chunk.channels[0]!.length;
		}
		assert.equal(frames, source.frameCount);
	}

	function wav(name: string, frames: number, channels: number): File {
		const pcm = Array.from({ length: channels }, () => new Float32Array(frames).fill(0.25));
		const bytes = Uint8Array.from(encodeWav(pcm, { sampleRate, bitDepth: 32, float: true }));
		return new File([bytes], `${name}.wav`, { type: 'audio/wav' });
	}
});
