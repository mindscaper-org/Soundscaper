/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiInstrument, MidiNote } from '../midi-model.ts';
import type { MidiFileEvent } from '../midi-file-types.ts';
import { createMidiExpressionIndex, midiExpressionPhaseArea, midiExpressionStateIndex, midiNoteSoundEnd, type MidiExpressionTimeline } from './midi-expression.ts';

interface PreparedNote {
	readonly index: number;
	readonly startFrame: number;
	readonly soundEnd: number;
	readonly frequency: number;
	readonly amplitude: number;
	readonly onsetPhaseArea: number;
	readonly timeline: MidiExpressionTimeline;
}

/** Render any source window independently, so playback and persisted PCM share a clock. */
export function renderMidiFrames(
	notes: readonly MidiNote[], instrument: MidiInstrument, sampleRate: number,
	startFrame: number, frameCount: number,
	events: readonly MidiFileEvent[] = [],
): Float32Array<ArrayBuffer> {
	assertWindow(sampleRate, startFrame, frameCount);
	return createMidiRenderer(notes, instrument, sampleRate, events)(startFrame, frameCount);
}

/** Own one compiled note/expression snapshot for independent source windows. */
export function createMidiRenderer(
	notes: readonly MidiNote[], instrument: MidiInstrument, sampleRate: number,
	events: readonly MidiFileEvent[] = [],
): (startFrame: number, frameCount: number) => Float32Array<ArrayBuffer> {
	if (typeof instrument !== 'string') throw new Error('Native instrument synthesis requires the desktop MIDI renderer.');
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 1) throw new RangeError('Invalid MIDI synthesis sample rate.');
	const expression = createMidiExpressionIndex(events);
	const prepared = notes.map((note, index): PreparedNote => {
		const timeline = expression.forNote(note);
		const onsetState = timeline.states[midiExpressionStateIndex(timeline.states, note.startFrame)]!;
		return { index, startFrame: note.startFrame, soundEnd: midiNoteSoundEnd(note, timeline),
			frequency: 440 * 2 ** ((note.pitch - 69) / 12), amplitude: note.velocity / 127 * 0.18,
			onsetPhaseArea: midiExpressionPhaseArea(onsetState, note.startFrame), timeline };
	}).filter(note => note.amplitude && note.soundEnd > note.startFrame).sort((left, right) => left.startFrame - right.startFrame);
	let capacity = 1;
	while (capacity < prepared.length) capacity *= 2;
	const ends = new Float64Array(capacity * 2);
	for (let index = 0; index < prepared.length; index += 1) ends[capacity + index] = prepared[index]!.soundEnd;
	for (let index = capacity - 1; index > 0; index -= 1) ends[index] = Math.max(ends[index * 2]!, ends[index * 2 + 1]!);
	const attack = Math.max(1, Math.round(sampleRate * 0.003));
	const release = Math.max(1, Math.round(sampleRate * 0.008));
	return (startFrame, frameCount) => {
		assertWindow(sampleRate, startFrame, frameCount);
		const output = new Float32Array(frameCount);
		const visible: PreparedNote[] = [];
		const endFrame = startFrame + frameCount;
		const visit = (node: number, left: number, right: number): void => {
			if (left >= prepared.length || prepared[left]!.startFrame >= endFrame || ends[node]! <= startFrame) return;
			if (right - left === 1) { visible.push(prepared[left]!); return; }
			const middle = (left + right) >>> 1;
			visit(node * 2, left, middle);
			visit(node * 2 + 1, middle, right);
		};
		visit(1, 0, capacity);
		// Float32 accumulation retains the authored order even for unsorted notes.
		visible.sort((left, right) => left.index - right.index);
		for (const note of visible) {
			const { timeline, frequency, amplitude, onsetPhaseArea, soundEnd } = note;
			const from = Math.max(startFrame, note.startFrame);
			const to = Math.min(endFrame, soundEnd);
			let stateIndex = midiExpressionStateIndex(timeline.states, from);
			for (let fromState = from; fromState < to;) {
				const state = timeline.states[stateIndex]!;
				const stateEnd = Math.min(to, timeline.states[stateIndex + 1]?.frame ?? to);
				if (frequency * state.bendRatio < sampleRate / 2) {
					for (let frame = fromState; frame < stateEnd; frame += 1) {
						const age = frame - note.startFrame;
						const phase = (midiExpressionPhaseArea(state, frame) - onsetPhaseArea) * frequency / sampleRate;
						const envelope = Math.min(1, age / attack, (soundEnd - frame) / release);
						output[frame - startFrame]! += wave(instrument, phase) * amplitude * envelope * state.volume * state.expression;
					}
				}
				fromState = stateEnd;
				stateIndex += 1;
			}
		}
		for (let frame = 0; frame < frameCount; frame += 1) {
			if (output[frame] !== 0) output[frame] = Math.tanh(output[frame]!);
		}
		return output;
	};
}

function assertWindow(sampleRate: number, startFrame: number, frameCount: number): void {
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 1 || !Number.isSafeInteger(startFrame) || startFrame < 0
		|| !Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 4_194_304
		|| !Number.isSafeInteger(startFrame + frameCount)) {
		throw new RangeError('Invalid MIDI synthesis window.');
	}
}

function wave(instrument: MidiInstrument, phase: number): number {
	const cycle = phase - Math.floor(phase);
	switch (instrument) {
		case 'triangle': return 1 - 4 * Math.abs(cycle - 0.5);
		case 'square': return Math.tanh(Math.sin(2 * Math.PI * phase) * 4);
		case 'sawtooth': return 2 * cycle - 1;
		default: return Math.sin(2 * Math.PI * phase);
	}
}
