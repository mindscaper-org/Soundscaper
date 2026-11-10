/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { assertAudioProjectArchivePcm, readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

const RATE = 48_000;
type SessionOptions = NonNullable<Parameters<typeof controllerSession>[1]>;
const cases = [
	{ type: 'multi-tap-delay', label: 'Delay', params: { time: .1, delayType: 'bouncing-ball' } },
	{ type: 'highpass-filter', label: 'High-pass filter', params: { frequency: 700, rolloff: 24 } },
	{ type: 'lowpass-filter', label: 'Low-pass filter', params: { frequency: 700, rolloff: 24 } },
	{ type: 'noise-gate', label: 'Noise gate', params: { threshold: -30, stereoLink: 'independent' } },
	{ type: 'notch-filter', label: 'Notch filter', params: { frequency: 330 } },
	{ type: 'shelf-filter', label: 'Shelf filter', params: { gain: -12, filterType: 'high' } },
	{ type: 'tremolo', label: 'Tremolo', params: { depth: 70, waveform: 'triangle' } },
	{ type: 'vocoder', label: 'Vocoder', params: { bands: 20, outputMode: 'right-only' } },
] as const;

for (const effect of cases) test(`${effect.label} selection retains real DSP, Undo/Redo and exact archived PCM`, async context => {
	let playbackBuffers: unknown;
	const engine = { ...createMemoryEngine(), loadProject(_project: unknown, buffers: unknown) { playbackBuffers = buffers; } };
	const { controller, store } = await controllerSession(context, {
		engine: engine as unknown as SessionOptions['engine'],
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engineFactory: () => { throw new Error('Simple selection must use production dry-track PCM, not a substitute renderer.'); },
	});
	const input = signal(effect.type);
	const fileName = `${effect.type}.wav`;
	await controller.actions.project.importFiles([new File([Uint8Array.from(encodeWav(input, { sampleRate: RATE, bitDepth: 32, float: true }))], fileName, { type: 'audio/wav' })]);
	const imported: unknown = controller.project; assert.ok(validateSoundscaperProject(imported));
	const original = imported.sources[0], clip = imported.clips[0], track = imported.tracks.find(value =>
		value.type === 'audio' && Array.isArray(value.clipIds) && value.clipIds.includes(clip?.id ?? ''));
	assert.ok(original?.kind === 'audio' && clip?.kind === 'audio' && track);
	assert.ok(playbackBuffers && typeof playbackBuffers === 'object' && 'setIfFits' in playbackBuffers);
	const cache = playbackBuffers as { setIfFits(id: string, buffer: unknown): boolean };
	assert.equal(typeof cache.setIfFits, 'function');
	const resident = await store.loadSourceAudioBuffer(original.storageKey, await engine.getAudioContext());
	assert.ok(resident); assert.equal(cache.setIfFits(original.id, resident), true);
	// Remove the editor's96-frame import fades through the real action. Neutral inputs admit the
	// production CPU dry-track path; retained selection-menu workflows still cover native faded rendering.
	controller.actions.clip.update(clip.id, { fadeInFrames: 0, fadeOutFrames: 0 });
	controller.actions.timeline.selectClip(clip.id);
	controller.actions.timeline.setExactSelection(0, RATE, { trackIds: [track.id] });
	const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
	await controller.actions.effects.applySelection(effect);
	const edited: unknown = controller.project; assert.ok(validateSoundscaperProject(edited));
	const changed = edited.clips[0]; assert.ok(changed?.kind === 'audio');
	assert.notEqual(changed.sourceId, original.id, JSON.stringify(controller.getSnapshot().status));
	const result = edited.sources.find(value => value.id === changed.sourceId); assert.ok(result?.kind === 'audio');
	assert.ok(result.name.toLowerCase().includes(effect.label.toLowerCase()));
	assert.equal(result.frameCount, RATE); assert.equal(result.channelCount, 2); assert.equal(result.sampleRate, RATE);
	checkOutput(effect.type, await readCustodyPcm(store, result));
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, edited.clips);
	await controller.actions.project.flush();
	const reopened = await assertAudioProjectArchivePcm(context, store, controller.project, (name, channels) => {
		if (name === original.name) assertPcmChannelsEqual(channels, input, 'original authored WAV PCM');
		else checkOutput(effect.type, channels);
	});
	assert.equal(reopened.clips[0]?.sourceId, result.id);
});

function signal(type: typeof cases[number]['type']): Float32Array[] {
	if (type === 'multi-tap-delay') return [.25, -.125].map(value => {
		const samples = new Float32Array(RATE); samples[0] = value; return samples;
	});
	if (type === 'tremolo') return [.25, -.125].map(value => new Float32Array(RATE).fill(value));
	if (type === 'noise-gate') return [.001, .2].map(value => new Float32Array(RATE).fill(value));
	const frequency = type === 'notch-filter' ? 330 : type === 'shelf-filter' || type === 'vocoder' ? 1000 : 700;
	return (type === 'vocoder' ? [.8, .4] : [.25, .125]).map((amplitude, channel) => Float32Array.from({ length: RATE }, (_, frame) =>
		amplitude * Math.sin(2 * Math.PI * frequency * frame / RATE)
		+ (type === 'vocoder' && channel === 1 ? .4 * Math.sin(2 * Math.PI * 5000 * frame / RATE) : 0)));
}

function checkOutput(type: typeof cases[number]['type'], channels: readonly Float32Array[]): void {
	assert.equal(channels.length, 2);
	for (const channel of channels) { assert.equal(channel.length, RATE); assert.ok(channel.every(Number.isFinite)); }
	if (type === 'multi-tap-delay') {
		const frames = [0, 4800, 8640, 11520, 13440, 14400];
		assertPcmChannelsEqual(channels, [.25, -.125].map(value => {
			const expected = new Float32Array(RATE);
			for (const [echo, frame] of frames.entries()) expected[frame] = value * 10 ** (-6 * echo / 20);
			return expected;
		}), 'independent bouncing echo positions and dB amplitudes');
	} else if (type === 'tremolo') {
		for (const [channel, value] of [.25, -.125].entries()) for (let frame = 0; frame < RATE; frame++) {
			// A 4Hz triangle runs from .3 at its trough to1 at its peak, identically on both channels.
			const phase = frame % 12000 / 12000;
			const expected = value * (.3 + .7 * (1 - Math.abs(2 * phase - 1)));
			assert.ok(Math.abs(channels[channel]![frame]! - expected) < 1e-7);
		}
	} else if (type === 'noise-gate') {
		for (const [channel, value] of [.001 * 10 ** (-24 / 20), .2].entries()) {
			for (const sample of channels[channel]!.subarray(RATE / 2)) assert.ok(Math.abs(sample - value) < 1e-7);
		}
	} else if (type === 'vocoder') {
		assertPcmChannelsEqual([channels[0]!], [channels[1]!], 'Vocoded-audio mode replaces both channels with the right carrier result');
		const wanted = amplitude(channels[0]!, 1000), rejected = amplitude(channels[0]!, 5000);
		// Twenty analysis bands retain the modulator band and reject an equal-amplitude distant carrier by>14dB.
		assert.ok(wanted > .08, `wanted band ${wanted}`); assert.ok(wanted > rejected * 5, `wanted ${wanted}, rejected ${rejected}`);
	} else {
		for (const [channel, inputAmplitude] of [.25, .125].entries()) {
			const rms = Math.sqrt(channels[channel]!.subarray(RATE / 2).reduce((sum, value) => sum + value * value, 0) / (RATE / 2));
			const expected: number = type === 'notch-filter' ? 0 : inputAmplitude / Math.SQRT2
				* (type === 'shelf-filter' ? 10 ** (-12 / 40) : Math.SQRT1_2);
			assert.ok(Math.abs(rms - expected) < 1e-6, `${type} RMS ${rms}, expected ${expected}`);
		}
	}
}

function amplitude(samples: Float32Array, frequency: number): number {
	let real = 0, imaginary = 0;
	for (let frame = RATE / 2; frame < RATE; frame++) {
		const phase = 2 * Math.PI * frequency * frame / RATE;
		real += samples[frame]! * Math.cos(phase); imaginary += samples[frame]! * Math.sin(phase);
	}
	return 4 * Math.hypot(real, imaginary) / RATE;
}
