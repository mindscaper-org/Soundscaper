/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertAudacityEffectOutput } from '../../audacity-effects/pcm-channel-validation.ts';
import { loadStaffPadWasm, type StaffPadWasmRuntime } from '../../staffpad/runtime.js';
import { createStaffPadRuntimeLoader } from '../../staffpad/runtime-loader.js';
import { STAFFPAD_MAXIMUM_RENDER_BYTES } from '../../staffpad/parameters.js';
import { normalizeAutoTuneParams, type AutoTuneParams } from './definition.ts';
import { autoTunePeakBytes } from './contract.ts';
import { createAutoTunePitchDetector, nearestAutoTuneNote } from './pitch.ts';

interface Context {
	readonly staffPadRuntime?: StaffPadWasmRuntime;
	readonly staffPadWasmSource?: Parameters<typeof loadStaffPadWasm>[0];
	readonly isCancelled?: () => boolean;
	readonly onProgress?: (progress: number) => void;
}
const getRuntime = createStaffPadRuntimeLoader(loadStaffPadWasm);
const yieldToWorker = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });
function checkCancelled(context: Context): void {
	if (context.isCancelled?.()) throw new DOMException('Auto-Tune rendering was cancelled.', 'AbortError');
}

/** Selection-only, formant-preserving pitch correction. Analyze one shared
 * contour, then render channel pairs serially in the pinned StaffPad engine.
 * This keeps channel phase, duration and native memory independent of width.
 */
export async function applyAutoTune(input: readonly Float32Array[], sampleRate: number,
	params: Readonly<Record<string, unknown>> = {}, context: Context = {}): Promise<Float32Array[]> {
	const channels = assertAudacityEffectOutput(input);
	const frames = channels[0].length;
	const settings = normalizeAutoTuneParams(params);
	if (autoTunePeakBytes(frames, { sampleRate, channelCount: channels.length }) > STAFFPAD_MAXIMUM_RENDER_BYTES) {
		throw new RangeError('The Auto-Tune selection exceeds its render memory limit. Reduce the selection or channel count.');
	}
	checkCancelled(context);
	if (settings.amount === 0 || settings.mix === 0) return channels.map(channel => channel.slice());
	const hop = Math.round(sampleRate / 100);
	const contour = await analyze(channels, sampleRate, hop, settings, context);
	if (contour.every(value => value === 0)) return channels.map(channel => channel.slice());
	const runtime = context.staffPadRuntime ?? await (context.staffPadWasmSource == null ? getRuntime() : loadStaffPadWasm(context.staffPadWasmSource));
	checkCancelled(context);
	const output = channels.map(() => new Float32Array(frames));
	// Native stereo formant processing can leak a small signal into a silent
	// partner channel. Keep channels authored entirely silent exactly silent.
	const audible = channels.map(channel => channel.some(sample => sample !== 0));
	const ratioAt = (frame: number) => {
		const position = Math.min(contour.length - 1, Math.max(0, frame / hop));
		const left = Math.floor(position), right = Math.min(contour.length - 1, left + 1);
		return 2 ** ((contour[left] + (contour[right] - contour[left]) * (position - left)) / 12);
	};
	for (let group = 0; group < channels.length; group += 2) {
		const source = channels.slice(group, group + 2);
		const session = runtime.createSession(sampleRate, source.length, true);
		try {
			session.setParameters(1, ratioAt(0));
			let discard = session.latency(ratioAt(0));
			let fed = 0, written = 0, iterations = 0;
			while (written < frames) {
				checkCancelled(context);
				const available = session.availableOutput();
				if (available > 0) {
					const block = session.read(Math.min(available, runtime.maximumBlockSize));
					const skip = Math.min(discard, block[0].length);
					discard -= skip;
					const retained = Math.min(frames - written, block[0].length - skip);
					for (let channel = 0; channel < source.length; channel++) {
						if (!audible[group + channel]) continue;
						const target = output[group + channel], dry = source[channel], wet = block[channel];
						for (let frame = 0; frame < retained; frame++) target[written + frame] =
							dry[written + frame] * (1 - settings.mix / 100) + wet[skip + frame] * settings.mix / 100;
					}
					written += retained;
				} else {
					const required = Math.min(session.requiredInput(), runtime.maximumBlockSize);
					if (required < 1 || fed > frames * 4 + sampleRate * 2) throw new Error('Auto-Tune exceeded its bounded pitch-render flush.');
					session.setParameters(1, ratioAt(fed));
					session.feed(source, fed, required);
					fed += required;
				}
				if (++iterations % 64 === 0) {
					context.onProgress?.(.3 + .7 * (group + source.length * written / frames) / channels.length);
					await yieldToWorker();
				}
			}
		} finally { session.destroy(); }
	}
	checkCancelled(context);
	context.onProgress?.(1);
	return assertAudacityEffectOutput(output);
}

async function analyze(channels: readonly Float32Array[], rate: number, hop: number,
	settings: AutoTuneParams, context: Context): Promise<Float32Array> {
	const detect = createAutoTunePitchDetector(channels, rate);
	const contour = new Float32Array(Math.ceil(channels[0].length / hop) + 1);
	const smoothing = settings.retune === 0 ? 1 : -Math.expm1(-hop / (rate * settings.retune / 1000));
	let correction = 0;
	for (let index = 0; index < contour.length; index++) {
		checkCancelled(context);
		const frequency = detect(Math.min(channels[0].length - 1, index * hop));
		if (frequency === 0) correction = 0;
		else {
			const midi = 69 + 12 * Math.log2(frequency / 440);
			const target = (nearestAutoTuneNote(midi, settings.key, settings.scale) - midi) * settings.amount / 100;
			correction += smoothing * (target - correction);
		}
		contour[index] = correction;
		if (index % 32 === 0) {
			context.onProgress?.(.3 * index / contour.length);
			await yieldToWorker();
		}
	}
	return contour;
}
