/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiInstrument, MidiNote } from '../midi-model.ts';
import type { MidiFileEvent } from '../midi-file-types.ts';
import { compileMidiExpression, midiExpressionPhaseArea, midiExpressionStateIndex, midiNoteSoundEnd } from './midi-expression.ts';

/** Render any source window independently, so playback and persisted PCM share a clock. */
export function renderMidiFrames(
	notes: readonly MidiNote[], instrument: MidiInstrument, sampleRate: number,
	startFrame: number, frameCount: number,
	events: readonly MidiFileEvent[] = [],
): Float32Array<ArrayBuffer> {
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 1
		|| !Number.isSafeInteger(startFrame) || startFrame < 0
		|| !Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 4_194_304
		|| !Number.isSafeInteger(startFrame + frameCount)) {
		throw new RangeError('Invalid MIDI synthesis window.');
	}
	const output = new Float32Array(frameCount);
	const attack = Math.max(1, Math.round(sampleRate * 0.003));
	const release = Math.max(1, Math.round(sampleRate * 0.008));
	const channels = compileMidiExpression(events);
	for (const note of notes) {
		const timeline = channels[note.channel]!;
		const soundEnd = midiNoteSoundEnd(note, timeline);
		const from = Math.max(startFrame, note.startFrame);
		const to = Math.min(startFrame + frameCount, soundEnd);
		if (from >= to || !note.velocity) continue;
		const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
		const amplitude = note.velocity / 127 * 0.18;
		const onsetState = timeline.states[midiExpressionStateIndex(timeline.states, note.startFrame)]!;
		const onsetPhaseArea = midiExpressionPhaseArea(onsetState, note.startFrame);
		let stateIndex = midiExpressionStateIndex(timeline.states, from);
		for (let frame = from; frame < to; frame += 1) {
			while (timeline.states[stateIndex + 1] && timeline.states[stateIndex + 1]!.frame <= frame) stateIndex += 1;
			const state = timeline.states[stateIndex]!;
			if (frequency * state.bendRatio >= sampleRate / 2) continue;
			const age = frame - note.startFrame;
			const phase = (midiExpressionPhaseArea(state, frame) - onsetPhaseArea) * frequency / sampleRate;
			const envelope = Math.min(1, age / attack, (soundEnd - frame) / release);
			output[frame - startFrame]! += wave(instrument, phase) * amplitude * envelope * state.volume * state.expression;
		}
	}
	for (let frame = 0; frame < frameCount; frame += 1) output[frame] = Math.tanh(output[frame]!);
	return output;
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
