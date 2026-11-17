/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { parseAudacityEffectMacro } from '../src/common/editor/effect-macros.js';
import { applyAudacityNormalize, applyAudacityLoudnessNormalization } from '../src/common/editor/audacity-effects/basic.js';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';

test('the issue 17 imported macro processes a selection above the one-shot cap and survives save/reopen and undo', { timeout: 120_000 }, async context => {
	const factory = createNodeWebAudioEngineFactory(context);
	context.after(async () => { await factory.dispose(); });
	const { controller, store } = await controllerSession(context, { engine: factory.createEngine(), engineFactory: factory.createEngine });
	const frameCount = 8_000_003, sampleRate = 48_000;
	const source = createAudioSource({ id: 'lp-source', name: 'LP.wav', frameCount, channelCount: 2, sampleRate });
	const clip = createAudioClip({ id: 'lp-clip', sourceId: source.id, durationFrames: frameCount, sourceDurationFrames: frameCount, fadeInFrames: 0, fadeOutFrames: 0 });
	const track = createAudioTrack({ id: 'lp-track', name: 'LP', clipIds: [clip.id] });
	const project = createSoundscaperProject({ id: 'lp-project', sources: [source], clips: [clip], tracks: [track],
		sequences: [{ id: 'main', trackIds: [track.id] }], primarySequenceId: 'main' });
	const input = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: frameCount }, (_, frame) =>
		.1 * (channel + 1) * Math.sin(frame * .125) + .01));
	const writer = await store.beginSourceWrite(source.storageKey, source);
	for (let frame = 0; frame < frameCount; frame += source.chunkFrames) await writer.write(input.map(channel => channel.subarray(frame, frame + source.chunkFrames)));
	await writer.commit();
	await store.saveProject(project); await controller.actions.project.open(project);
	const text = 'SelectAll:\nNormalize:ApplyVolume="1" PeakLevel="0" RemoveDcOffset="1" StereoIndependent="0"\nSelectAll:\nLoudnessNormalization:DualMono="1" LUFSLevel="-16" NormalizeTo="0" RMSLevel="-1" StereoIndependent="1"';
	const parsed = parseAudacityEffectMacro(text), history = controller.getSnapshot().history.undoEntries.length;
	await controller.actions.macros.run({ name: 'LP', effects: parsed.effects });
	const changed = clipboardProject(controller.project), resultClip = changed.clips[0];
	assert.ok(resultClip?.kind === 'audio');
	const resultSource = changed.sources.find(candidate => candidate.id === resultClip.sourceId);
	assert.ok(resultSource?.kind === 'audio');
	assert.ok(validateSoundscaperProject(controller.project));
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	assert.deepEqual([resultSource.frameCount, resultSource.channelCount, resultSource.sampleRate, resultClip.fadeInFrames, resultClip.fadeOutFrames], [frameCount, 2, sampleRate, 0, 0]);
	const expected = applyAudacityLoudnessNormalization(applyAudacityNormalize(input, sampleRate, { peakDb: 0, removeDc: true, stereoIndependent: false }),
		sampleRate, { targetLufs: -16, mode: 'lufs', dualMono: true, stereoIndependent: true });
	let offset = 0;
	for await (const chunk of store.readSourceChunks(resultSource.storageKey)) {
		for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < chunk.frames; frame++) {
			if (Math.abs(chunk.channels[channel]![frame]! - expected[channel]![offset + frame]!) > 1e-6) assert.fail(`Output differs at channel ${channel}, frame ${offset + frame}: ${chunk.channels[channel]![frame]} vs ${expected[channel]![offset + frame]}`);
		}
		offset += chunk.frames;
	}
	assert.equal(offset, frameCount);
	await controller.actions.project.flush();
	const saved = await store.loadProject(project.id); assert.ok(saved);
	assert.deepEqual(saved, controller.project);
	controller.actions.edit.undo();
	assert.equal(clipboardProject(controller.project).clips[0]?.sourceId, source.id);
	controller.actions.edit.redo();
	assert.equal(clipboardProject(controller.project).clips[0]?.sourceId, resultSource.id);
	await controller.actions.project.open(saved);
	assert.equal(clipboardProject(controller.project).clips[0]?.sourceId, resultSource.id);
});
