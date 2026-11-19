/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiClipData } from '../midi-model.ts';
import type { MidiBlockEvent } from './midi-audio-renderer.ts';
import { splitMidiInstrumentPorts } from './midi-instrument-ports.ts';
import { createMidiChasedPrograms, type MidiChasedProgram } from './midi-chased-programs.ts';

interface ChasedVoice {
	readonly data: readonly number[];
	readonly channel: number;
	readonly program: MidiChasedProgram;
	held: boolean;
	captured: boolean;
}

/** DAW-style cold seek: restore channel state and sounding keys, without running past DSP. */
export function chaseMidiAudioEvents(events: readonly MidiBlockEvent[], start: number): MidiBlockEvent[] {
	const state: MidiBlockEvent[] = [], sustain = new Set<number>(), sostenuto = new Set<number>();
	const programs = createMidiChasedPrograms();
	const voices = new Set<ChasedVoice>();
	const channels = Array.from({ length: 16 }, () => ({
		voices: new Set<ChasedVoice>(), held: new Map<number | undefined, ChasedVoice[]>(),
	}));
	const restart = (voice: ChasedVoice): void => {
		for (const data of programs.select(voice.channel, voice.program)) state.push({ frame: 0, data });
		state.push({ frame: 0, data: voice.data });
	};
	const captured = (voice: ChasedVoice): boolean => voice.captured && sostenuto.has(voice.channel);
	const prune = (voice: ChasedVoice): void => {
		if (!voice.held && !sustain.has(voice.channel) && !captured(voice)) {
			voices.delete(voice);
			channels[voice.channel]!.voices.delete(voice);
		}
	};
	for (const event of events) {
		if (event.frame >= start) break;
		const [status, first, second] = event.data, channel = status! & 15, type = status! & 240;
		const current = channels[channel]!;
		if (type === 0x90 && second) {
			const voice: ChasedVoice = { data: event.data, channel, program: programs.capture(channel), held: true, captured: false };
			voices.add(voice);
			current.voices.add(voice);
			const held = current.held.get(first);
			if (held) held.push(voice); else current.held.set(first, [voice]);
			continue;
		}
		if (type === 0x80 || type === 0x90) {
			for (const voice of current.held.get(first) ?? []) { voice.held = false; prune(voice); }
			current.held.delete(first);
			continue;
		}
		state.push({ frame: 0, data: event.data });
		programs.observe(event.data);
		if (type !== 0xb0) continue;
		if (first === 64) {
			if (second! >= 64) sustain.add(channel);
			else if (sustain.delete(channel)) for (const voice of current.voices) prune(voice);
		} else if (first === 66 && second! >= 64 && !sostenuto.has(channel)) {
			sostenuto.add(channel);
			for (const voice of current.voices) if (voice.held) voice.captured = true;
		} else if (first === 121 || (first === 66 && second! < 64)) {
			if (first === 121) sustain.delete(channel);
			sostenuto.delete(channel);
			for (const voice of current.voices) { voice.captured = false; prune(voice); }
		} else if (first === 120) {
			current.held.clear();
			for (const voice of current.voices) voices.delete(voice);
			current.voices.clear();
		} else if (first! >= 123 && first! <= 127) {
			current.held.clear();
			for (const voice of current.voices) { voice.held = false; prune(voice); }
		}
	}
	for (const channel of sostenuto) state.push({ frame: 0, data: [0xb0 | channel, 66, 0] });
	for (const voice of voices) if (captured(voice)) restart(voice);
	for (const channel of sostenuto) state.push({ frame: 0, data: [0xb0 | channel, 66, 127] });
	for (const voice of voices) if (!captured(voice)) restart(voice);
	for (const voice of voices) if (!voice.held) state.push({ frame: 0, data: [0x80 | voice.channel, voice.data[1]!, 0] });
	for (const data of programs.restore()) state.push({ frame: 0, data });
	return state;
}

export interface MidiAudioEventTimeline {
	readonly frames: Float64Array<ArrayBuffer>;
	readonly messages: Uint32Array<ArrayBuffer>;
	readonly ports?: readonly MidiAudioEventTimeline[];
}

export function firstMidiAudioEventAtOrAfter(events: readonly MidiBlockEvent[], frame: number): number {
	let low = 0, high = events.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (events[middle]!.frame < frame) low = middle + 1; else high = middle;
	}
	return low;
}

export function compileMidiAudioTimeline(data: MidiClipData, start = 0): MidiAudioEventTimeline {
	const parts = splitMidiInstrumentPorts(data);
	if (parts.length !== 1 || parts[0] !== data) {
		return { frames: new Float64Array(), messages: new Uint32Array(), ports: parts.map(part => compileMidiAudioTimeline(part, start)) };
	}
	const all = midiAudioEvents(data);
	const chased = start ? chaseMidiAudioEvents(all, start) : [];
	const first = start ? firstMidiAudioEventAtOrAfter(all, start) : 0;
	const length = chased.length + all.length - first;
	const frames = new Float64Array(length), messages = new Uint32Array(length);
	let output = 0;
	const append = (events: readonly MidiBlockEvent[], begin: number, offset: number): void => {
		for (let index = begin; index < events.length; index++) {
			const { frame, data: bytes } = events[index]!;
			frames[output] = frame - offset;
			messages[output++] = bytes[0]! | (bytes[1] ?? 0) << 8 | (bytes[2] ?? 0) << 16 | bytes.length << 24;
		}
	};
	append(chased, 0, 0);
	append(all, first, start || 0);
	return { frames, messages };
}

/** Keep same-sample panic provenance consistent with Standard MIDI export. */
export function midiAudioEvents(data: MidiClipData): MidiBlockEvent[] {
	const auxiliary = data.interchange?.events ?? [];
	const ordered: (MidiBlockEvent & { order: number })[] = [];
	const stops = new Map<string, number>();
	const releases = new Map<string, number>();
	for (const [index, event] of auxiliary.entries()) {
		if (event.status < 0x80 || event.status >= 0xf0 || [0x80, 0x90].includes(event.status & 0xf0)) continue;
		const order = (index + 1) / (auxiliary.length + 1);
		ordered.push({ frame: event.frame, data: [event.status, ...event.data], order });
		const key = `${event.frame}:${event.status & 15}`;
		if ((event.status & 0xf0) === 0xb0 && event.data[0] === 120 && !stops.has(key)) stops.set(key, order - 0.5 / (auxiliary.length + 1));
		if (event.releaseId) releases.set(`${event.releaseId}:${key}`, order - 0.5 / (auxiliary.length + 1));
	}
	for (const note of data.notes) {
		if (!note.velocity) continue;
		const key = `${note.startFrame}:${note.channel}`;
		const beforeStop = note.onsetStop?.kind === 'all-notes-off' ? releases.get(`${note.onsetStop.releaseId}:${key}`)
			: note.onsetStop ? stops.get(key) : undefined;
		if (note.onsetStop && beforeStop === undefined) throw new RangeError('Native MIDI instrument rendering requires the causal same-frame key-release event.');
		ordered.push({ frame: note.startFrame, data: [0x90 | note.channel, note.pitch, note.velocity], order: beforeStop ?? 2 },
			{ frame: note.onsetStop ? note.startFrame : note.startFrame + note.durationFrames,
				data: [0x80 | note.channel, note.pitch, note.releaseVelocity ?? 0], order: 1 });
	}
	return ordered.sort((a, b) => a.frame - b.frame || a.order - b.order).map(({ frame, data }) => ({ frame, data }));
}
