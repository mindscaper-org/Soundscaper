/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { MockOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';

function document() {
	return createSoundscaperProject({ id: 'loop-position', loop: { enabled: true, startFrame: 0, endFrame: 48_000 },
		sources: [createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 144_000, channelCount: 1 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 144_000, sourceDurationFrames: 144_000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
}

for (const operation of ['disable', 'extend'] as const) test(`changing a playing loop preserves its audible cursor when ${operation}`, async context => {
	const device = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext });
	context.after(async () => { await engine.dispose(); });
	engine.loadProject(document(), new Map([['source', new MockAudioBuffer(1, 144_000, 48_000) as unknown as AudioBuffer]]));
	await engine.play(); device.currentTime = 1.25;
	assert.equal(engine.getPositionFrames(), 12_000);
	engine.setLoop({ enabled: operation !== 'disable', startFrame: 0, endFrame: operation === 'extend' ? 96_000 : 48_000 });
	assert.equal(engine.getPositionFrames(), 12_000, 'the new loop cannot reinterpret elapsed time already played under the old loop');
	await Promise.resolve();
	assert.equal(engine.getPositionFrames(), 12_000);
});

test('disabling a prepared speed loop preserves its programme position', async context => {
	const device = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext,
		offlineAudioContextFactory: options => new MockOfflineAudioContext(options) as unknown as OfflineAudioContext });
	context.after(async () => { await engine.dispose(); });
	engine.loadProject(document(), new Map([['source', new MockAudioBuffer(1, 144_000, 48_000) as unknown as AudioBuffer]]));
	await engine.playAtSpeed(2, { preservePitch: true,
		pitchPreserver: channels => Promise.resolve(channels.map(() => new Float32Array(72_000))) });
	device.currentTime = .625; assert.equal(engine.getPositionFrames(), 12_000);
	engine.setLoop({ enabled: false, startFrame: 0, endFrame: 48_000 });
	assert.equal(engine.getPositionFrames(), 12_000);
});

test('loop changes retain paused cursors and snap playing cursors outside the new region', async context => {
	const device = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext });
	context.after(async () => { await engine.dispose(); });
	engine.loadProject(document(), new Map([['source', new MockAudioBuffer(1, 144_000, 48_000) as unknown as AudioBuffer]]));
	engine.seek(12_000); engine.setLoop({ enabled: true, startFrame: 48_000, endFrame: 96_000 });
	assert.equal(engine.getPositionFrames(), 12_000, 'a paused loop edit does not seek');
	await engine.play(); assert.equal(engine.getPositionFrames(), 48_000);
	device.currentTime = .25;
	engine.setLoop({ enabled: true, startFrame: 96_000, endFrame: 144_000 });
	assert.equal(engine.getPositionFrames(), 96_000, 'a newly excluded playing cursor still enters the loop');
});

test('the shipping controller loop toggle preserves the playhead after a completed repetition', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const device = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext });
	const pcm = new MockAudioBuffer(1, 144_000, 48_000) as unknown as AudioBuffer;
	const store = Object.assign(createMemoryStore(), { async loadSourceAudioBuffer() { return pcm; } });
	store.audioSources.set('source', [new Float32Array(144_000).fill(.25)]);
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'], engine });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await store.saveProject(document()); await controller.actions.project.open(document());
	await controller.actions.transport.playPause(); device.currentTime = 1.25;
	assert.equal(engine.getPositionFrames(), 12_000);
	await controller.actions.transport.toggleLoop();
	assert.equal(controller.project!.loop!.enabled, false);
	assert.equal(engine.getPositionFrames(), 12_000);
});
