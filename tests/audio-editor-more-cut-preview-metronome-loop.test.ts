/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController } from './helpers/audio-editor-controller-harness.js';
import { MockAudioContext, MockParam } from './helpers/mock-audio-context.js';
import { MockOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';

test('Cut Preview metronome follows the audition instead of an unrelated saved loop', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const clicks: number[] = [];
	const contexts: MockAudioContext[] = [];
	const previous = { audio: globalThis.AudioContext, offline: globalThis.OfflineAudioContext };
	class AudioContextFixture extends MockAudioContext {
		constructor(options: Readonly<{ sampleRate?: number }> = {}) { super(options); contexts.push(this); }
		createOscillator() {
			const frequency = new MockParam();
			return { frequency, connect() {}, disconnect() {}, onended: null,
				start: () => { clicks.push(frequency.value); }, stop() {} };
		}
		createGain() {
			const node = super.createGain();
			Object.assign(Reflect.get(node, 'gain') as object, { exponentialRampToValueAtTime() {} });
			return node;
		}
		createBuffer(...args: Parameters<MockAudioContext['createBuffer']>) {
			const buffer = super.createBuffer(...args);
			return Object.assign(buffer, { copyToChannel: (samples: Float32Array, channel: number) => buffer.getChannelData(channel).set(samples) });
		}
	}
	class OfflineContextFixture extends MockOfflineAudioContext {
		constructor(channels: number, length: number, sampleRate: number) {
			super({ numberOfChannels: channels, length, sampleRate });
		}
	}
	globalThis.AudioContext = AudioContextFixture as unknown as typeof AudioContext;
	globalThis.OfflineAudioContext = OfflineContextFixture as unknown as typeof OfflineAudioContext;
	context.after(() => { globalThis.AudioContext = previous.audio; globalThis.OfflineAudioContext = previous.offline; });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const source = createAudioSource({ id: 'source', frameCount: 480_000, channelCount: 1, sampleRate: 48_000 });
	const project = createSoundscaperProject({ id: 'cut-preview-loop-clicks', sampleRate: 48_000, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
	const store = createMemoryStore();
	store.audioSources.set(source.id, [new Float32Array(source.frameCount).fill(0.25)]);
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await store.saveProject(project); await controller.actions.project.open(project);
	controller.actions.transport.setLoopRegion(0, 12_000);
	controller.actions.timeline.setSelection(144_000, 240_000, { trackIds: ['track'] });
	controller.actions.transport.toggleMetronome();
	await controller.actions.transport.playCutPreview();
	for (let turn = 0; turn < 30; turn++) await Promise.resolve();
	assert.deepEqual(clicks, [880], 'the audition begins at timeline second1, a beat accent rather than the saved loop bar accent');
	contexts[0]!.currentTime = 0.2;
	await new Promise<void>(resolve => { setTimeout(resolve, 80); });
	for (let turn = 0; turn < 30; turn++) await Promise.resolve();
	assert.deepEqual(clicks, [880], 'the saved quarter-second loop cannot insert another click before the next half-second beat');
	assert.deepEqual(controller.project!.loop, { enabled: true, startFrame: 0, endFrame: 12_000 });
});
