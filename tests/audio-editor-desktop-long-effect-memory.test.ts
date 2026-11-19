/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { parseAudacityEffectMacro } from '../src/common/editor/effect-macros.js';
import { normalizeAudioEditorAdvancedPreferences } from '../src/common/editor/advanced-preferences.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';

test('the desktop default admits long Reverse steps and keeps their audio available to subsequent effects', { timeout: 120_000 }, async context => {
	const factory = createNodeWebAudioEngineFactory(context);
	const fileService = createAudioEditorFileService({ bridge: {} });
	const { controller, store } = await controllerSession(context, { fileService, engine: factory.createEngine(), engineFactory: factory.createEngine });
	const frameCount = 8_000_003, sampleRate = 48_000;
	const source = createAudioSource({ id: 'long-source', name: 'Recording.wav', frameCount, channelCount: 2, sampleRate });
	const clip = createAudioClip({ id: 'long-clip', sourceId: source.id, durationFrames: frameCount, sourceDurationFrames: frameCount, fadeInFrames: 0, fadeOutFrames: 0 });
	const track = createAudioTrack({ id: 'long-track', name: 'Recording', clipIds: [clip.id] });
	const project = createSoundscaperProject({ id: 'long-project', sources: [source], clips: [clip], tracks: [track],
		sequences: [{ id: 'main', trackIds: [track.id] }], primarySequenceId: 'main' });
	const sample = (frame: number, channel: number) => Math.fround(((frame % 97) - 48) * (channel + 1) / 512);
	const writer = await store.beginSourceWrite(source.storageKey, source);
	for (let start = 0; start < frameCount; start += source.chunkFrames) {
		await writer.write(Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: Math.min(source.chunkFrames, frameCount - start) }, (_, frame) => sample(start + frame, channel))));
	}
	await writer.commit(); await store.saveProject(project); await controller.actions.project.open(project);
	const preferences = controller.getSnapshot().preferences;
	assert.ok(preferences && typeof preferences === 'object' && 'advanced' in preferences);
	assert.equal(normalizeAudioEditorAdvancedPreferences(preferences.advanced).effectMemoryLimitGiB, 4);
	const parsed = parseAudacityEffectMacro('SelectAll:\nReverse:\nSelectAll:\nReverse:\n');
	await controller.actions.macros.run({ name: 'Two long reverses', effects: parsed.effects });
	const changed = clipboardProject(controller.project), resultClip = changed.clips[0]; assert.ok(resultClip?.kind === 'audio');
	const resultSource = changed.sources.find(candidate => candidate.id === resultClip.sourceId); assert.ok(resultSource?.kind === 'audio');
	let offset = 0;
	for await (const chunk of store.readSourceChunks(resultSource.storageKey)) {
		for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < chunk.frames; frame++) {
			if (Math.abs(chunk.channels[channel]![frame]! - sample(offset + frame, channel)) > 1e-6) assert.fail(`Long effect audio changed at ${offset + frame}/${channel}`);
		}
		offset += chunk.frames;
	}
	assert.equal(offset, frameCount);
});
