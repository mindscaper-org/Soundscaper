/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { MockOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';

test('Loop to selection preserves a one-sample region after pitch-preserving speed conversion', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const device = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext,
		offlineAudioContextFactory: options => new MockOfflineAudioContext(options) as unknown as OfflineAudioContext });
	const pcm = new MockAudioBuffer(2, 48_000, 48_000) as unknown as AudioBuffer;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const project = createSoundscaperProject({ id: 'subsample-loop', sources: [createAudioSource({ id: 'source',
		frameCount: 48_000, channelCount: 2, sampleRate: 48_000 })], clips: [createAudioClip({ id: 'clip', sourceId: 'source',
		durationFrames: 48_000, sourceDurationFrames: 48_000 })], tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
	const store = Object.assign(createMemoryStore(), { async loadSourceAudioBuffer() { return pcm; } });
	store.audioSources.set('source', [new Float32Array(48_000).fill(.25), new Float32Array(48_000).fill(.25)]);
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'], engine,
		playAtSpeedPitchPreserver: channels => Promise.resolve(channels.map(() => new Float32Array(24_000))) });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await store.saveProject(project); await controller.actions.project.open(project);
	controller.actions.timeline.setSelection(24_001, 24_002, { trackIds: ['track'] });
	controller.actions.transport.loopToSelection();
	await new Promise<void>(resolve => { setTimeout(resolve, 0); });
	await controller.actions.preferences.update({ playback: { playAtSpeedMode: 'staffpad' } });
	controller.actions.transport.setPlayAtSpeedRate(2);
	await controller.actions.transport.playAtSpeed();
	const source = device.bufferSources.at(-1)!;
	assert.equal(source.loop, true);
	assert.ok(source.loopEnd > source.loopStart, 'independent integer rounding must not collapse a valid region into a whole-buffer native loop');
	assert.ok(Math.abs(source.loopStart - 24_001 / 96_000) < 1e-12);
	assert.ok(Math.abs(source.loopEnd - 24_002 / 96_000) < 1e-12);
	assert.equal(source.started?.[1], source.loopStart, 'the first sample uses the same continuous prepared position as the loop');
});
