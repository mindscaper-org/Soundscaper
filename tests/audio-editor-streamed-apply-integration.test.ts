/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';

for (const mode of ['range', 'clips', 'source', 'macro'] as const) test(`ordinary ${mode} effects stream below the memory ceiling and retain save/reopen and undo`, async context => {
	const factory = createNodeWebAudioEngineFactory(context); context.after(async () => { await factory.dispose(); });
	const { controller, store } = await controllerSession(context, { engine: factory.createEngine(), engineFactory: factory.createEngine });
	const frameCount = 140003, sampleRate = 48000;
	const source = createAudioSource({ id: 'original', frameCount, sampleRate, channelCount: 2 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: frameCount, sourceDurationFrames: frameCount, fadeInFrames: 0, fadeOutFrames: 0 });
	const track = createAudioTrack({ id: 'track', clipIds: [clip.id] });
	const project = createSoundscaperProject({ id: 'streamed-project', sources: [source], clips: [clip], tracks: [track],
		sequences: [{ id: 'main', trackIds: [track.id] }], primarySequenceId: 'main' });
	const input = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: frameCount }, (_, frame) => .1 * (channel + 1) * Math.sin(frame * .125) + .01));
	const writer = await store.beginSourceWrite(source.storageKey, source);
	for (let offset = 0; offset < frameCount; offset += source.chunkFrames) await writer.write(input.map(channel => channel.subarray(offset, offset + source.chunkFrames)));
	await writer.commit(); await store.saveProject(project); await controller.actions.project.open(project);
	if (mode === 'source') controller.actions.effects.setSourceSelection({ clipId: clip.id, startFrame: 17, endFrame: frameCount - 23 });
	else if (mode === 'clips') controller.actions.edit.commit({ type: 'selection/set', startFrame: 0, endFrame: 0, trackIds: [track.id], clipIds: [clip.id] });
	else controller.actions.edit.commit({ type: 'selection/set', startFrame: 0, endFrame: frameCount, trackIds: [track.id], clipIds: [] });
	const before = controller.getSnapshot().history.undoEntries.length;
	if (mode === 'macro') await controller.actions.macros.run({ effects: [{ type: 'audacity-invert', params: {} }, { type: 'audacity-normalize', params: { removeDc: false, peakDb: -3 } }, { type: 'audacity-invert', params: {} }] });
	else await controller.actions.effects.applySelection({ type: 'audacity-normalize', params: { removeDc: false, peakDb: -3 } });
	const changed = clipboardProject(controller.project), resultClip = changed.clips[0]; assert.ok(resultClip?.kind === 'audio');
	const printed = changed.sources.find(item => item.id === resultClip.sourceId); assert.ok(printed?.kind === 'audio');
	assert.notEqual(printed.id, source.id); assert.ok(validateSoundscaperProject(controller.project));
	assert.equal(controller.getSnapshot().history.undoEntries.length, before + 1);
	const start = mode === 'source' ? 17 : 0, end = mode === 'source' ? frameCount - 23 : frameCount;
	const normalized = await applyAudioSelectionEffectAsync('audacity-normalize', input.map(channel => channel.slice(start, end)), sampleRate, { removeDc: false, peakDb: -3 });
	const expected = input.map((channel, index) => { const output = channel.slice(); output.set(normalized[index]!, start); return output; });
	let offset = 0;
	for await (const chunk of store.readSourceChunks(printed.storageKey)) { chunk.channels.forEach((channel, index) => assert.deepEqual(channel, expected[index]!.subarray(offset, offset + chunk.frames))); offset += chunk.frames; }
	assert.equal(offset, frameCount);
	await controller.actions.project.flush(); const saved = await store.loadProject(project.id); assert.ok(saved);
	controller.actions.edit.undo(); assert.equal(clipboardProject(controller.project).clips[0]?.sourceId, source.id);
	controller.actions.edit.redo(); assert.equal(clipboardProject(controller.project).clips[0]?.sourceId, printed.id);
	await controller.actions.project.open(saved); assert.equal(clipboardProject(controller.project).clips[0]?.sourceId, printed.id);
});
