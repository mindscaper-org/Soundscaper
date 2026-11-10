/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StaffPadWasmRuntime } from '../../staffpad/wasm-instance.ts';
import { normalizeAutoTuneParams } from './definition.ts';
import { autoTuneRealtimeGeometry } from './realtime-contract.ts';
import { createAutoTunePitchDetector, nearestAutoTuneNote } from './pitch.ts';
import { createAutoTuneNativeStream } from './native-stream.ts';

export function createAutoTuneProcessor(options: {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly params?: Readonly<Record<string, unknown>>;
	readonly staffPadRuntime: StaffPadWasmRuntime;
}) {
	const { sampleRate, channelCount } = options;
	const geometry = autoTuneRealtimeGeometry(sampleRate, channelCount);
	let settings = normalizeAutoTuneParams(options.params);
	const history = Array.from({ length: channelCount }, () => new Float32Array(geometry.latencyFrames + 1));
	const analysis = Array.from({ length: channelCount }, () => new Float32Array(geometry.analysisFrames));
	const detect = createAutoTunePitchDetector(analysis, sampleRate);
	const samples = new Float64Array(channelCount);
	const audible = new Uint8Array(channelCount);
	const native = createAutoTuneNativeStream(options.staffPadRuntime, sampleRate, channelCount, geometry);
	const hop = Math.round(sampleRate / 100);
	let cursor = 0, untilAnalysis = geometry.analysisFrames, correction = 0, ratio = 1, disposed = false;
	function assertActive(): void { if (disposed) throw new Error('Auto-Tune processor was disposed.'); }
	return {
		latencyFrames: geometry.latencyFrames,
		updateParams(params: Readonly<Record<string, unknown>>): void {
			assertActive();
			settings = normalizeAutoTuneParams({ ...settings, ...params });
		},
		reset(): void {
			assertActive();
			native.reset();
			for (const channel of history) channel.fill(0);
			audible.fill(0);
			cursor = 0; untilAnalysis = geometry.analysisFrames; correction = 0; ratio = 1;
		},
		dispose(): void { if (!disposed) { disposed = true; native.dispose(); } },
		processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void {
			assertActive();
			const capacity = history[0].length;
			for (let frame = 0; frame < frames; frame++) {
				for (let channel = 0; channel < channelCount; channel++) {
					const value = input[channel]?.[frame] ?? 0;
					history[channel][cursor] = value;
					if (value !== 0) audible[channel] = 1;
					samples[channel] = history[channel][(cursor + capacity - geometry.analysisDelayFrames) % capacity];
				}
				if (--untilAnalysis === 0) {
					for (let channel = 0; channel < channelCount; channel++) for (let index = 0; index < geometry.analysisFrames; index++) {
						analysis[channel][index] = history[channel][(cursor + capacity - geometry.analysisFrames + 1 + index) % capacity];
					}
					const frequency = detect(geometry.analysisFrames / 2);
					if (frequency === 0) correction = 0;
					else {
						const midi = 69 + 12 * Math.log2(frequency / 440);
						const target = (nearestAutoTuneNote(midi, settings.key, settings.scale) - midi) * settings.amount / 100;
						const smoothing = settings.retune === 0 ? 1 : -Math.expm1(-hop / (sampleRate * settings.retune / 1000));
						correction += smoothing * (target - correction);
					}
					ratio = 2 ** (correction / 12);
					untilAnalysis = hop;
				}
				native.processFrame(samples, ratio);
				const mix = settings.amount === 0 ? 0 : settings.mix / 100;
				for (let channel = 0; channel < output.length; channel++) {
					const dry = history[channel]?.[(cursor + 1) % capacity] ?? 0;
					output[channel][frame] = audible[channel] ? dry * (1 - mix) + samples[channel] * mix : 0;
				}
				cursor = (cursor + 1) % capacity;
			}
		},
	};
}
