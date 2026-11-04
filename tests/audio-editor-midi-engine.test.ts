/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { createAudioPreviewProject } from '../src/common/editor/engine/audio-preview-project.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { ENGINE_SCHEDULE_LOOP_AHEAD } from '../src/common/editor/engine/runtime-symbols.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { MockGainRenderingOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

const SAMPLE_RATE = 48_000;
const FRAMES = 4_800;
const NOTE = { id: 'a4', pitch: 69, startFrame: 0, durationFrames: FRAMES, velocity: 100, channel: 0 };

interface StartedSource {
	readonly buffer: AudioBuffer;
	readonly started: readonly [number, number, number];
	readonly stopped?: boolean;
}

function fixture(midiChanges: Readonly<Record<string, unknown>> = {}, audioChanges: Readonly<Record<string, unknown>> = {}) {
	const midiSamples = renderMidiFrames([NOTE], 'sine', SAMPLE_RATE, 0, FRAMES);
	const audioSamples = new Float32Array(FRAMES).fill(0.1);
	const midiBuffer = new MockAudioBuffer(1, FRAMES, SAMPLE_RATE) as unknown as AudioBuffer;
	midiBuffer.getChannelData(0).set(midiSamples);
	const audioBuffer = new MockAudioBuffer(1, FRAMES, SAMPLE_RATE) as unknown as AudioBuffer;
	audioBuffer.getChannelData(0).set(audioSamples);
	const project = createAudioPreviewProject({
		title: 'MIDI with recorded audio', sampleRate: SAMPLE_RATE, masterChannels: 1,
		sources: ['midi-source', 'audio-source'].map(id => ({ id, frameCount: FRAMES, channelCount: 1, sampleRate: SAMPLE_RATE })),
		clips: [
			createMidiClip({ id: 'midi-clip', sourceId: 'midi-source', durationFrames: FRAMES, notes: [NOTE] }),
			createAudioClip({ id: 'audio-clip', sourceId: 'audio-source', durationFrames: FRAMES }),
		],
		tracks: [
			createMidiTrack({ id: 'midi-track', clipIds: ['midi-clip'], instrument: 'sine', ...midiChanges }),
			createAudioTrack({ id: 'audio-track', clipIds: ['audio-clip'], ...audioChanges }),
		],
	});
	const context = new MockAudioContext({ sampleRate: SAMPLE_RATE });
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as unknown as EngineAudioContext,
		offlineAudioContextFactory: options => new MockGainRenderingOfflineAudioContext(options) as unknown as OfflineAudioContext,
		meterInterval: 1_000,
	});
	engine.loadProject(project, new Map([['midi-source', midiBuffer], ['audio-source', audioBuffer]]));
	const started = () => context.bufferSources as unknown as readonly StartedSource[];
	return { engine, context, started, midiBuffer, audioBuffer, midiSamples, audioSamples };
}

test('MIDI and recorded audio share the live transport clock, seek offsets and stop lifecycle', async () => {
	const { engine, context, started, midiBuffer, audioBuffer } = fixture();
	try {
		await engine.play();
		assert.equal(started().length, 2);
		assert.equal(started()[0]!.started[0], started()[1]!.started[0]);
		assert.equal(started()[0]!.started[2], FRAMES / SAMPLE_RATE);
		assert.deepEqual(new Set(started().map(source => source.buffer)), new Set([midiBuffer, audioBuffer]));

		const firstRun = [...started()];
		context.currentTime = 0.02;
		assert.equal(engine.seek(1_200), 1_200);
		await new Promise<void>(resolve => { setImmediate(resolve); });
		const sought = started().slice(firstRun.length);
		assert.equal(sought.length, 2);
		assert.equal(sought[0]!.started[0], sought[1]!.started[0]);
		for (const source of sought) {
			assert.equal(source.started[1], 1_200 / SAMPLE_RATE);
			assert.equal(source.started[2], (FRAMES - 1_200) / SAMPLE_RATE);
		}
		assert.ok(firstRun.every(source => source.stopped));
		engine.stop();
		assert.ok(sought.every(source => source.stopped));
	} finally { await engine.dispose(); }
});

test('loop lookahead repeats MIDI and audio together on each shared iteration boundary', async () => {
	const { engine, context, started } = fixture();
	try {
		engine.setLoop({ enabled: true, startFrame: 0, endFrame: 2_400 });
		await engine.play();
		await new Promise<void>(resolve => { setImmediate(resolve); });
		context.currentTime = 0.3;
		(engine as unknown as EngineRuntimeHost)[ENGINE_SCHEDULE_LOOP_AHEAD]();
		await new Promise<void>(resolve => { setImmediate(resolve); });
		const iterations = new Map<number, StartedSource[]>();
		for (const source of started()) {
			const when = source.started[0];
			const iteration = iterations.get(when) ?? [];
			iteration.push(source);
			iterations.set(when, iteration);
		}
		assert.ok(iterations.size >= 2);
		for (const iteration of iterations.values()) {
			assert.equal(iteration.length, 2);
			assert.notStrictEqual(iteration[0]!.buffer, iteration[1]!.buffer);
			for (const source of iteration) {
				assert.equal(source.started[1], 0);
				assert.equal(source.started[2], 0.05);
			}
		}
	} finally { engine.stop(); await engine.dispose(); }
});

test('offline delivery mixes MIDI PCM with audio and honors mute and solo for either track', async () => {
	const render = async (midiChanges = {}, audioChanges = {}) => {
		const value = fixture(midiChanges, audioChanges);
		try {
			const rendered = await value.engine.renderMix({ startFrame: 0, endFrame: FRAMES, includeTail: false });
			if (!('getChannelData' in rendered)) assert.fail('Expected an offline AudioBuffer.');
			return { samples: rendered.getChannelData(0), midi: value.midiSamples, audio: value.audioSamples };
		} finally { await value.engine.dispose(); }
	};
	const mixed = await render();
	const midiMuted = await render({ mute: true });
	const midiSolo = await render({ solo: true });
	const audioSolo = await render({}, { solo: true });
	const audioMuted = await render({}, { mute: true });
	for (const frame of [0, 100, 601, 2_000, 4_600]) {
		assert.ok(Math.abs(mixed.samples[frame]! - (mixed.midi[frame]! + mixed.audio[frame]!)) < 1e-6);
		assert.ok(Math.abs(midiMuted.samples[frame]! - mixed.audio[frame]!) < 1e-6);
		assert.ok(Math.abs(audioSolo.samples[frame]! - mixed.audio[frame]!) < 1e-6);
		assert.ok(Math.abs(midiSolo.samples[frame]! - mixed.midi[frame]!) < 1e-6);
		assert.ok(Math.abs(audioMuted.samples[frame]! - mixed.midi[frame]!) < 1e-6);
	}
});
