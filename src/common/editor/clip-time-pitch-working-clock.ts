/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWindowedSincChannelSampler } from './windowed-sinc-kernel.ts';
import { reverseFloat32 } from './clip-time-pitch-cache-values.ts';

export const CLIP_TIME_PITCH_RESAMPLER_REVISION = 'windowed-sinc-radius24-v1';
export const CLIP_TIME_PITCH_RESAMPLER_SCRATCH_BYTES = 48 * Float64Array.BYTES_PER_ELEMENT;

/** A higher programme clock can represent pitched frequencies above source Nyquist. */
export function describeClipTimePitchWorkingClock(sourceRate: number, projectRate: number | undefined, pitchCents: number,
	frameCount: number): Readonly<{ sampleRate: number; resampledInputFrames?: number }> {
	if (projectRate !== undefined && (!Number.isSafeInteger(projectRate) || projectRate < 8000 || projectRate > 768_000)) {
		throw new RangeError('The clip pitch programme rate must be between 8000 and 768000 Hz.');
	}
	const sampleRate = pitchCents > 0 ? Math.max(sourceRate, Math.min(projectRate ?? sourceRate, 192_000)) : sourceRate;
	if (sampleRate === sourceRate) return Object.freeze({ sampleRate });
	const resampledInputFrames = Math.max(1, Math.round(frameCount * sampleRate / sourceRate));
	if (!Number.isSafeInteger(resampledInputFrames)) throw new RangeError('The clip pitch working input is too large.');
	return Object.freeze({ sampleRate, resampledInputFrames });
}

interface InputPlan {
	readonly sourceFrameCount: number;
	readonly sourceRange: Readonly<{ startFrame: number; frameCount: number }>;
	readonly direction: 'forward' | 'reverse';
	readonly sourceSampleRate: number;
	readonly sampleRate: number;
	readonly resampledInputFrames?: number;
}
interface PreparedInput {
	readonly channels: Float32Array[];
	readonly selection: Readonly<{ startFrame: number; frameCount: number }>;
	readonly ownsChannels: boolean;
}

/** Called only after source, render working-set and output quota admission. */
export async function prepareClipTimePitchWorkingInput(channels: Float32Array[], plan: InputPlan,
	options: Readonly<{ signal?: AbortSignal | null; ownsChannels: boolean }>): Promise<PreparedInput> {
	options.signal?.throwIfAborted();
	const { startFrame, frameCount } = plan.sourceRange;
	if (plan.resampledInputFrames === undefined) {
		return {
			channels: plan.direction === 'reverse' ? channels.map(reverseFloat32) : channels,
			selection: { startFrame: plan.direction === 'reverse' ? plan.sourceFrameCount - startFrame - frameCount : startFrame, frameCount },
			ownsChannels: options.ownsChannels || plan.direction === 'reverse',
		};
	}
	// Only the selected immutable window reaches StaffPad. Keep raw-source bounds
	// and identity in the plan; these new arrays have their own working clock.
	let selected = channels.map(channel => channel.subarray(startFrame, startFrame + frameCount));
	if (plan.direction === 'reverse') selected = selected.map(reverseFloat32);
	const output = channels.map(() => new Float32Array(plan.resampledInputFrames!));
	const sample = createWindowedSincChannelSampler(24, .94);
	const step = plan.sourceSampleRate / plan.sampleRate;
	for (let frame = 0; frame < plan.resampledInputFrames; frame++) {
		if (frame % 8192 === 0) {
			options.signal?.throwIfAborted();
			if (frame > 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
			options.signal?.throwIfAborted();
		}
		sample(selected, 0, frameCount, frame * step, output, frame);
	}
	options.signal?.throwIfAborted();
	return { channels: output, selection: { startFrame: 0, frameCount: plan.resampledInputFrames }, ownsChannels: true };
}
