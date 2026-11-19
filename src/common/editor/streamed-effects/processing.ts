/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeAudioSelectionEffectParams } from '../effects.js';
import { assertAudacityEffectOutput } from '../audacity-effects/pcm-channel-validation.ts';
import { prepareStreamedNormalization } from '../audacity-effects/streamed-normalization.ts';
import { createStreamedKernel } from './kernels.ts';
import { streamClickRemoval } from './click-removal.ts';
import { packetizeEffectPcm } from './packetize.ts';
import { streamFirEqualizer } from './fir-equalizer.ts';
import { canStreamSelectionEffect, isStreamedGainEffect, STREAMED_EFFECT_CHUNK_FRAMES, type StreamedEffectStep } from './admission.ts';

export interface StreamedProcessingRequest {
	readonly effects: readonly StreamedEffectStep[];
	readonly sampleRate: number; readonly channelCount: number; readonly frameCount: number;
	readonly wasmModule?: WebAssembly.Module;
}
export interface StreamedProcessingPorts {
	readonly assertCurrent: () => void;
	readonly yieldToMainThread?: boolean;
	readonly read: (start: number, end: number) => Promise<readonly Float32Array[]>;
	readonly readControl?: (start: number, end: number) => Promise<readonly Float32Array[]>;
	readonly write: (channels: Float32Array[]) => Promise<unknown>;
}
type Stream = () => AsyncGenerator<Float32Array[]>;

/** No whole-selection PCM: every producer suspends until its consumer has released a bounded packet. */
export async function runStreamedSelectionProcessing(request: StreamedProcessingRequest, ports: StreamedProcessingPorts): Promise<void> {
	const { sampleRate, channelCount, frameCount, effects } = request;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1 || !Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 32
		|| !Number.isFinite(sampleRate) || sampleRate <= 0 || !effects.length || !effects.every(effect => canStreamSelectionEffect(effect.type, effect.params))) {
		throw new RangeError('Invalid streamed effect geometry or unsupported effect.');
	}
	if (effects.every(effect => isStreamedGainEffect(effect.type))) {
		const stream = await prepareStreamedNormalization({ ...request, read: (start, end) => ports.read(start, end),
			assertCurrent: ports.assertCurrent, yieldToMainThread: ports.yieldToMainThread });
		for await (const channels of stream()) { ports.assertCurrent(); await ports.write(channels); ports.assertCurrent(); }
		return;
	}
	if (effects.some(effect => isStreamedGainEffect(effect.type))) throw new RangeError('Normalization requires a staged analysis barrier.');
	const prefetch = !effects.some(effect => effect.type === 'audacity-auto-duck');
	const read = async (start: number, end: number): Promise<Float32Array[]> => {
		ports.assertCurrent();
		const channels = [...await ports.read(start, end)]; ports.assertCurrent();
		if (channels.length !== channelCount || channels.some(channel => channel.length !== end - start)) throw new RangeError('Invalid streamed PCM channel geometry.');
		assertAudacityEffectOutput(channels); return channels;
	};
	let stream: Stream = async function* () {
		let pending = read(0, Math.min(frameCount, STREAMED_EFFECT_CHUNK_FRAMES));
		for (let offset = 0; offset < frameCount; offset += STREAMED_EFFECT_CHUNK_FRAMES) {
			const channels = await pending, next = offset + STREAMED_EFFECT_CHUNK_FRAMES;
			if (next < frameCount && prefetch) {
				pending = read(next, Math.min(frameCount, next + STREAMED_EFFECT_CHUNK_FRAMES)); void pending.catch(() => undefined);
			}
			yield channels;
			if (next < frameCount && !prefetch) pending = read(next, Math.min(frameCount, next + STREAMED_EFFECT_CHUNK_FRAMES));
		}
	};
	for (const effect of effects) {
		const params = normalizeAudioSelectionEffectParams(effect.type, effect.params) as Readonly<Record<string, unknown>>;
		const previous = stream;
		stream = effect.type === 'audacity-click-removal' ? () => streamClickRemoval(previous(), params, frameCount)
			: effect.type === 'audacity-filter-curve-eq' || effect.type === 'audacity-graphic-eq'
			? () => streamFirEqualizer(previous(), effect.type, params, sampleRate, frameCount)
			: () => process(previous(), effect.type, params, effect.context);
	}
	let written = 0, lastYield = performance.now();
	for await (const channels of packetizeEffectPcm(stream(), frameCount)) {
		ports.assertCurrent(); assertAudacityEffectOutput(channels);
		written += channels[0]!.length; if (written > frameCount) throw new RangeError('Streamed output exceeds the selection.');
		await ports.write(channels); ports.assertCurrent();
		if (ports.yieldToMainThread !== false && performance.now() - lastYield >= 8) { await new Promise<void>(resolve => setTimeout(resolve, 0)); ports.assertCurrent(); lastYield = performance.now(); }
	}
	if (written !== frameCount) throw new RangeError('Streamed output ended before the selection.');

	async function* process(input: AsyncGenerator<Float32Array[]>, type: string, params: Readonly<Record<string, unknown>>, context?: Readonly<Record<string, unknown>> | null): AsyncGenerator<Float32Array[]> {
		if (type === 'audacity-echo' && (Number(params.decay) === 0 || Math.floor(Number(params.delaySeconds) * sampleRate) >= frameCount)
			|| type === 'tremolo' && params.depth === 0 || type === 'noise-gate' && params.rangeDb === 0) { yield* input; return; }
		const processor = createStreamedKernel(type, params, sampleRate, channelCount, request.wasmModule, frameCount, context);
		const latency = processor.latencyFrames ?? 0;
		let seen = 0;
		try {
			for await (const channels of input) { ports.assertCurrent(); const control = type === 'audacity-auto-duck' ? [...await ports.readControl!(seen, seen + channels[0]!.length)] : undefined;
				if (control) { assertAudacityEffectOutput(control); if (control.some(channel => channel.length !== channels[0]!.length)) throw new RangeError('Invalid detector PCM.'); }
				const result = block(channels, control); if (result) yield result; }
			processor.finish?.();
			let silence: Float32Array[] | undefined;
			for (let remaining = latency; remaining > 0;) {
				ports.assertCurrent(); const count = Math.min(STREAMED_EFFECT_CHUNK_FRAMES, remaining); remaining -= count;
				if (silence?.[0]?.length !== count) silence = Array.from({ length: channelCount }, () => new Float32Array(count));
				const result = block(silence); if (result) yield result;
			}
		} finally { processor.dispose?.(); }
		function block(channels: Float32Array[], control?: Float32Array[]): Float32Array[] | null {
			const frames = channels[0]!.length, output = channels.map(() => new Float32Array(frames));
			processor.process(channels, output, control);
			const start = Math.max(0, latency - seen), end = Math.min(frames, frameCount + latency - seen); seen += frames;
			return start === 0 && end === frames ? output : end > start ? output.map(channel => channel.subarray(start, end)) : null;
		}
	}
}
