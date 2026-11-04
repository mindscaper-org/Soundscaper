/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiFileEvent } from '../midi-file-types.ts';
import type { MidiNote } from '../midi-model.ts';

export interface MidiExpressionState {
	readonly frame: number;
	readonly volume: number;
	readonly expression: number;
	readonly sustain: boolean;
	readonly bendRatio: number;
	/** Integral of the channel's pitch ratio from frame zero to this change. */
	readonly pitchArea: number;
}

export interface MidiExpressionTimeline {
	readonly states: readonly MidiExpressionState[];
	readonly stops: readonly number[];
	readonly keyReleases: readonly number[];
	readonly pedalReleases: readonly number[];
}

const INITIAL_STATE: MidiExpressionState = {
	frame: 0, volume: 1, expression: 1, sustain: false, bendRatio: 1, pitchArea: 0,
};

/** Compile setup and performance controls once per render window, independently of prior windows. */
export function compileMidiExpression(events: readonly MidiFileEvent[]): readonly MidiExpressionTimeline[] {
	const channels = Array.from({ length: 16 }, () => ({ states: [INITIAL_STATE], stops: [] as number[], keyReleases: [] as number[], pedalReleases: [] as number[] }));
	const relevant = events.filter(event => (event.status & 0xf0) === 0xb0 || (event.status & 0xf0) === 0xe0)
		.slice().sort((left, right) => left.frame - right.frame);
	for (const event of relevant) {
		if (!Number.isSafeInteger(event.frame) || event.frame < 0 || event.data.length !== 2
			|| event.data.some(value => !Number.isSafeInteger(value) || value < 0 || value > 127)) {
			throw new RangeError('MIDI expression requires valid channel messages and frame positions.');
		}
		const channel = channels[event.status & 0x0f]!;
		const previous = channel.states[channel.states.length - 1]!;
		const next = { ...previous, frame: event.frame,
			pitchArea: midiExpressionPhaseArea(previous, event.frame) };
		if ((event.status & 0xf0) === 0xe0) {
			const bend = event.data[0]! | (event.data[1]! << 7);
			next.bendRatio = 2 ** (((bend - 8_192) / 8_192 * 2) / 12);
		} else {
			switch (event.data[0]) {
				case 7: next.volume = event.data[1]! / 127; break;
				case 11: next.expression = event.data[1]! / 127; break;
				case 64: next.sustain = event.data[1]! >= 64; break;
				case 120: channel.stops.push(event.frame); break;
				case 123: channel.keyReleases.push(event.frame); break;
				case 121:
					next.expression = 1;
					next.sustain = false;
					next.bendRatio = 1;
					break;
				default: continue;
			}
		}
		if (previous.sustain && !next.sustain) channel.pedalReleases.push(event.frame);
		channel.states.push(next);
	}
	return channels;
}

/** Use the final setup event at a frame before sounding notes at that frame. */
export function midiExpressionStateIndex(states: readonly MidiExpressionState[], frame: number): number {
	let low = 0, high = states.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (states[middle]!.frame <= frame) low = middle + 1; else high = middle;
	}
	return Math.max(0, low - 1);
}

export function midiExpressionPhaseArea(state: MidiExpressionState, frame: number): number {
	return state.pitchArea + (frame - state.frame) * state.bendRatio;
}

/** Key release remains authored data; a pedal extends only the sounding voice. */
export function midiNoteSoundEnd(note: MidiNote, timeline: MidiExpressionTimeline): number {
	let end = Math.min(note.startFrame + note.durationFrames,
		timeline.keyReleases[firstFrameAfter(timeline.keyReleases, note.startFrame)] ?? Number.POSITIVE_INFINITY);
	const atRelease = midiExpressionStateIndex(timeline.states, end);
	if (timeline.states[atRelease]!.sustain) {
		end = timeline.pedalReleases[firstFrameAfter(timeline.pedalReleases, end)] ?? Number.POSITIVE_INFINITY;
	}
	return Math.min(end, timeline.stops[firstFrameAfter(timeline.stops, note.startFrame)] ?? Number.POSITIVE_INFINITY);
}

function firstFrameAfter(frames: readonly number[], frame: number): number {
	let low = 0, high = frames.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (frames[middle]! <= frame) low = middle + 1; else high = middle;
	}
	return low;
}
