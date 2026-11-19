/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMidiPitchState } from './midi-expression-pitch.ts';
import type { MidiFileEvent } from '../midi-file-types.ts';
import type { MidiNote } from '../midi-model.ts';

export interface MidiExpressionState {
	readonly frame: number;
	readonly volume: number;
	readonly expression: number;
	readonly sustain: boolean;
	readonly sostenuto: boolean;
	readonly mono: boolean;
	readonly pan: number;
	readonly bendRatio: number;
	/** Integral of the channel's pitch ratio from frame zero to this change. */
	readonly pitchArea: number;
}

export interface MidiExpressionTimeline {
	readonly states: readonly MidiExpressionState[];
	readonly stops: readonly number[];
	readonly keyReleases: readonly number[];
	readonly pedalReleases: readonly number[];
	readonly sostenutoWindows: readonly Readonly<{ start: number; end: number }>[];
}

const INITIAL_STATE: MidiExpressionState = {
	frame: 0, volume: 1, expression: 1, sustain: false, sostenuto: false, mono: false, pan: 64, bendRatio: 1, pitchArea: 0,
};

/** Compile setup and performance controls once per render window, independently of prior windows. */
export function compileMidiExpression(events: readonly MidiFileEvent[]): readonly MidiExpressionTimeline[] {
	const relevant = events.filter(event => (event.status & 0xf0) === 0xb0 || (event.status & 0xf0) === 0xe0)
		.slice().sort((left, right) => left.frame - right.frame);
	return compileExpressionEvents(relevant);
}

/** One source snapshot owns namespace compilation and note-on selector lookup. */
export function createMidiExpressionIndex(events: readonly MidiFileEvent[]) {
	const groups = new Map<number, MidiFileEvent[]>();
	const selectors: { frame: number; port: number }[] = [];
	let port = 0;
	for (const event of [...events].sort((left, right) => left.frame - right.frame)) {
		const status = event.status;
		if (status === 255 && event.metaType === 0x21 && event.data.length === 1) {
			port = event.data[0]!; selectors.push({ frame: event.frame, port });
		} else if ((status & 0xf0) === 0xb0 || (status & 0xf0) === 0xe0) {
			const group = groups.get(port); if (group) group.push(event); else groups.set(port, [event]);
		}
	}
	const timelines = new Map([...groups].map(([key, group]) => [key, compileExpressionEvents(group)]));
	const empty = compileExpressionEvents([]);
	return { forNote(note: MidiNote): MidiExpressionTimeline {
		let selected = note.midiPort;
		if (selected === undefined) {
			let low = 0, high = selectors.length;
			while (low < high) {
				const middle = (low + high) >>> 1;
				if (selectors[middle]!.frame <= note.startFrame) low = middle + 1; else high = middle;
			}
			selected = selectors[low - 1]?.port ?? 0;
		}
		return (timelines.get(selected) ?? empty)[note.channel]!;
	} };
}

function compileExpressionEvents(relevant: readonly MidiFileEvent[]): readonly MidiExpressionTimeline[] {
	const channels = Array.from({ length: 16 }, () => ({ states: [INITIAL_STATE], stops: [] as number[], keyReleases: [] as number[], pedalReleases: [] as number[], sostenutoWindows: [] as { start: number; end: number }[], pitch: createMidiPitchState() }));
	for (const event of relevant) {
		if (!Number.isSafeInteger(event.frame) || event.frame < 0 || event.data.length !== 2
			|| event.data.some(value => !Number.isSafeInteger(value) || value < 0 || value > 127)) {
			throw new RangeError('MIDI expression requires valid channel messages and frame positions.');
		}
		const status = event.status;
		const channel = channels[status & 0x0f]!;
		const previous = channel.states[channel.states.length - 1]!;
		const next = { ...previous, frame: event.frame,
			pitchArea: midiExpressionPhaseArea(previous, event.frame) };
		const pitch = channel.pitch.observe(status, event.data);
		if (pitch !== null) next.bendRatio = pitch;
		if ((status & 0xf0) !== 0xe0) {
			switch (event.data[0]) {
				case 7: next.volume = event.data[1]! / 127; break;
				case 10: next.pan = event.data[1]!; break;
				case 11: next.expression = event.data[1]! / 127; break;
				case 64: next.sustain = event.data[1]! >= 64; break;
				case 66: next.sostenuto = event.data[1]! >= 64; break;
				case 120: channel.stops.push(event.frame); break;
				case 126: next.mono = true; channel.keyReleases.push(event.frame); break;
				case 127: next.mono = false; channel.keyReleases.push(event.frame); break;
				case 123: case 124: case 125:
					channel.keyReleases.push(event.frame); break;
				case 121:
					next.expression = 1;
					next.sustain = false;
					next.sostenuto = false;
					next.bendRatio = 1;
					break;
				default: if (pitch === null) continue;
			}
		}
		if (!previous.sostenuto && next.sostenuto) channel.sostenutoWindows.push({ start: event.frame, end: Infinity });
		if (previous.sostenuto && !next.sostenuto) channel.sostenutoWindows.at(-1)!.end = event.frame;
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
	if (note.onsetStop?.kind === 'all-sound-off' && note.onsetStop.frame === note.startFrame
		&& note.onsetStop.channel === note.channel) return note.startFrame;
	if (note.onsetStop?.kind === 'all-notes-off' && note.onsetStop.frame === note.startFrame && note.onsetStop.channel === note.channel) {
		return note.onsetStop.soundEndFrame ?? Number.POSITIVE_INFINITY;
	}
	let end = Math.min(note.startFrame + note.durationFrames,
		timeline.keyReleases[firstFrameAfter(timeline.keyReleases, note.startFrame)] ?? Number.POSITIVE_INFINITY);
	const keyEnd = end;
	let lower = 0, upper = timeline.sostenutoWindows.length;
	while (lower < upper) {
		const middle = (lower + upper) >>> 1;
		if (timeline.sostenutoWindows[middle]!.start <= keyEnd) lower = middle + 1; else upper = middle;
	}
	const captured = timeline.sostenutoWindows[lower - 1];
	if (captured && captured.start > note.startFrame && captured.end > keyEnd) end = captured.end;
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
