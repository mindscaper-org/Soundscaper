/* SPDX-License-Identifier: AGPL-3.0-only */
import { rackTailFrames } from '../../../../effects.js';
import { isRealtimeEffectMacroStepType } from '../../../../effect-macro-steps.ts';

interface Step { readonly id?: string; readonly type: string; readonly params: Readonly<Record<string, unknown>>; readonly context?: Readonly<Record<string, unknown>> | null }

/** Match timeline rack warming, including finite echoes longer than ten seconds. */
export function macroRackHistoryFrames(steps: readonly Step[], sampleRate: number, startFrame: number): number {
	if (startFrame <= 0) return 0;
	const realtime = steps.filter(step => isRealtimeEffectMacroStepType(step.type));
	if (!realtime.length) return 0;
	return Math.min(startFrame, Math.max(Math.min(startFrame, sampleRate * 10),
		rackTailFrames(realtime, sampleRate, startFrame / sampleRate)));
}

/** Prefixes, concatenation, browser buffers and capture scratch coexist during staging. */
export function macroRackHistoryScratchBytes(steps: readonly Step[], historyFrames: number, channelCount: number, stagedFromStart = true): number {
	let staged = stagedFromStart, capturesHistory = false;
	for (const step of steps) {
		if (!isRealtimeEffectMacroStepType(step.type)) staged = true;
		else if (staged) capturesHistory = true;
	}
	if (!capturesHistory) return 0;
	const controls = new Set(steps.filter(step => step.type === 'audacity-auto-duck')
		.map(step => step.context?.controlTrackId).filter(id => typeof id === 'string' && id));
	const bytes = historyFrames * (channelCount + controls.size * 2) * Float32Array.BYTES_PER_ELEMENT * 5;
	if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Macro rack history exceeds its supported memory range.');
	return bytes;
}

/** A preceding offline step owns only the selection; its neighbours remain authored PCM. */
export function prependMacroRackHistory(channels: readonly Float32Array[], before: readonly Float32Array[], frames: number): readonly Float32Array[] {
	if (!frames) return channels;
	if (before.length !== channels.length || before.some(channel => channel.length !== frames)) {
		throw new RangeError('Macro rack history must match the selected channel layout and requested prefix.');
	}
	return channels.map((channel, index) => {
		const combined = new Float32Array(frames + channel.length);
		combined.set(before[index]!); combined.set(channel, frames);
		return combined;
	});
}
