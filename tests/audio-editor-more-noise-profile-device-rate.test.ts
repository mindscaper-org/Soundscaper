/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { captureAudacityNoiseProfile } from '../src/common/editor/audacity-effects/spectral.js';
import { effectLatencyFrames } from '../src/common/editor/engine/effect-rack.ts';
import { compileProjectPathPdcPlanV21 } from '../src/common/editor/engine/project-path-pdc-plan-v21.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createEffect, effectTailFrames } from '../src/common/editor/effects.js';
import { initializePffft } from '../src/common/editor/pffft.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController } from './helpers/audio-editor-controller-harness.js';
import { MockAudioWorkletNode, MockGainRenderingOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';

import { MockAudioContext } from './helpers/mock-audio-context.js';

await initializePffft();

function tone(rate: number, frames: number, frequency = 1000): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => .25 * Math.sin(2 * Math.PI * frequency * frame / rate));
}

function render(profileRate: number, deviceRate: number, blocks: readonly number[], reductionDb = 0) {
	const captured = captureAudacityNoiseProfile([tone(profileRate, 4096)], profileRate);
	const profile = { ...captured, meanPowers: Array.from(captured.meanPowers) };
	const effect = createEffect('audacity-noise-reduction', { id: 'noise', params: { reductionDb }, context: { noiseProfile: profile } });
	const processor = createAudacityLiveProcessor(effect.type, deviceRate, effect.params, { noiseProfile: profile });
	const latency = effectLatencyFrames(effect, deviceRate);
	assert.equal(processor.latencyFrames, latency, 'the device graph compensates the realized processing delay');
	const source = tone(deviceRate, Math.round(deviceRate / 2));
	const input = new Float32Array(source.length + latency + Math.ceil(deviceRate / 2)); input.set(source);
	const output = new Float32Array(input.length);
	let offset = 0; let block = 0;
	while (offset < input.length) {
		const count = Math.min(blocks[block++ % blocks.length]!, input.length - offset);
		processor.process([input.subarray(offset, offset + count)], [output.subarray(offset, offset + count)]);
		offset += count;
	}
	return { source, output: output.subarray(latency), effect, latency, profile, processor };
}

for (const [profileRate, deviceRate] of [[48_000, 44_100], [44_100, 48_000], [24_000, 48_000], [96_000, 44_100]] as const) {
	test(`a ${profileRate} Hz noise profile remains audible and time aligned on a ${deviceRate} Hz device`, () => {
		const { source, output } = render(profileRate, deviceRate, [128]);
		let error = 0;
		for (let frame = 1000; frame < source.length - 1000; frame++) error = Math.max(error, Math.abs(source[frame]! - output[frame]!));
		assert.ok(error < .0001, `clock conversion changed the 1 kHz signal or its compensated position: ${error}`);
	});
}

test('rate-converted noise reduction retains its clock across arbitrary caller blocks and resets', () => {
	const fixed = render(48_000, 44_100, [128], 24);
	const varied = render(48_000, 44_100, [1, 47, 256, 19, 511], 24);
	assert.deepEqual(varied.output, fixed.output);
	assert.ok(fixed.output.some(sample => Math.abs(sample) > .001));
	const tail = effectTailFrames(fixed.effect, 44_100);
	assert.ok(tail > 0 && tail < 4096);
	assert.ok(fixed.output.subarray(fixed.source.length + tail).every(sample => Math.abs(sample) < .0001), 'the declared physical tail includes conversion filters');
	fixed.processor.reset();
	const zeros = new Float32Array(128);
	const output = new Float32Array(128).fill(1);
	fixed.processor.process([zeros], [output]);
	assert.ok(output.every(sample => sample === 0), 'reset retires all conversion and spectral history');
});

test('a lower-rate profile preserves device audio above its Nyquist and neutral reduction remains exact', () => {
	const captured = captureAudacityNoiseProfile([tone(24_000, 4096)], 24_000);
	for (const reductionDb of [0, 12]) {
		const processor = createAudacityLiveProcessor('audacity-noise-reduction', 48_000, { reductionDb }, { noiseProfile: captured });
		const input = new Float32Array(48_000); input.set(tone(48_000, 30_000, 16_000));
		const output = new Float32Array(input.length);
		for (let start = 0; start < input.length; start += 128) processor.process([input.subarray(start, start + 128)], [output.subarray(start, start + 128)]);
		const aligned = output.subarray(processor.latencyFrames);
		let error = 0;
		for (let frame = 1000; frame < 25_000; frame++) error = Math.max(error, Math.abs(input[frame]! - aligned[frame]!));
		assert.ok(error < .0001, `a learned low-rate profile must not remove unprofiled high frequencies: ${error}`);
		if (reductionDb === 0) assert.deepEqual(aligned.subarray(0, 30_000), input.subarray(0, 30_000));
	}
});

test('device-rate Reduce and Residue remain complementary without changing the captured FFT grid', () => {
	const profile = captureAudacityNoiseProfile([tone(44_100, 4096)], 44_100);
	const saved = profile.meanPowers.slice();
	const processors = ['reduce', 'residue'].map(output => createAudacityLiveProcessor('audacity-noise-reduction', 48_000,
		{ reductionDb: 24, output }, { noiseProfile: profile }));
	const latency = processors[0]!.latencyFrames;
	const input = new Float32Array(48_000); input.set(tone(48_000, 20_000));
	const outputs = processors.map(() => new Float32Array(input.length));
	for (let start = 0; start < input.length; start += 128) processors.forEach((processor, index) => {
		processor.process([input.subarray(start, start + 128)], [outputs[index]!.subarray(start, start + 128)]);
	});
	let error = 0;
	for (let frame = 0; frame < input.length - latency; frame++) error = Math.max(error,
		Math.abs(outputs[0]![frame + latency]! + outputs[1]![frame + latency]! - input[frame]!));
	assert.ok(error < .00000003, `Reduce plus Residue must recover the device's original samples: ${error}`);
	assert.deepEqual(profile.meanPowers, saved);
	assert.throws(() => processors[0]!.updateParams({ output: 'invalid' }), /output/u);
});

test('Get Noise Profile then Play uses the project profile on the ordinary device clock and compensates parallel tracks', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const previousContext = globalThis.AudioContext;
	const previousWorklet = globalThis.AudioWorkletNode;
	const processors: ReturnType<typeof createAudacityLiveProcessor>[] = [];
	class DeviceContext extends MockAudioContext {
		constructor() { super({ sampleRate: 44_100 }); }
		createBuffer(channels: number, frames: number, rate: number) {
			const buffer = super.createBuffer(channels, frames, rate);
			return Object.assign(buffer, { copyToChannel(values: Float32Array, channel: number) { buffer.getChannelData(channel).set(values); } });
		}
	}
	class Worklet extends MockAudioWorkletNode {
		constructor(device: DeviceContext, name: string, options: AudioWorkletNodeOptions = {}) {
			super(device, name, options);
			const settings = options.processorOptions as { effectType?: string; params?: Record<string, unknown>; noiseProfile?: unknown } | undefined;
			if (settings?.effectType === 'audacity-noise-reduction') processors.push(createAudacityLiveProcessor(settings.effectType,
				device.sampleRate, settings.params, { noiseProfile: settings.noiseProfile }));
		}
	}
	globalThis.AudioContext = DeviceContext as unknown as typeof AudioContext;
	globalThis.AudioWorkletNode = Worklet as unknown as typeof AudioWorkletNode;
	context.after(() => { globalThis.AudioContext = previousContext; globalThis.AudioWorkletNode = previousWorklet; });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const source = createAudioSource({ id: 'source', frameCount: 4096, channelCount: 2, sampleRate: 48_000 });
	const project = createSoundscaperProject({ id: 'noise-profile-device-clock', sources: [source],
		clips: ['wet', 'dry'].map(id => createAudioClip({ id: `${id}-clip`, sourceId: source.id, durationFrames: 4096, sourceDurationFrames: 4096 })),
		tracks: ['wet', 'dry'].map(id => createAudioTrack({ id, clipIds: [`${id}-clip`] })) });
	const store = createMemoryStore(); store.audioSources.set(source.id, [tone(48_000, 4096), tone(48_000, 4096)]);
	const engineFactory: NonNullable<Options['engineFactory']> = options => createAudioEditorEngine({ ...options,
		audioContextFactory: null, offlineAudioContextFactory: settings => new MockGainRenderingOfflineAudioContext(settings) as unknown as OfflineAudioContext });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'], engineFactory });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await store.saveProject(project); await controller.actions.project.open(project);
	const id = controller.actions.effects.add({ type: 'audacity-noise-reduction', scope: 'track', trackId: 'wet' });
	assert.ok(id); controller.actions.timeline.setSelection(0, 4096);
	await controller.actions.effects.captureRackNoiseProfile('track', 'wet', id);
	await controller.actions.transport.playPause();
	assert.equal(processors.length, 1, 'the menu-added effect reaches the production listening graph');
	const plan = compileProjectPathPdcPlanV21(controller.project!, { sampleRate: 44_100 });
	assert.equal(plan.latencyFrames, processors[0]!.latencyFrames);
	assert.ok([...plan.edgeCompensationFrames.values()].includes(processors[0]!.latencyFrames), 'the dry parallel path receives the complete converted delay');
});
