/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiClipData } from '../midi-model.ts';
import type { MidiBlockEvent } from './midi-audio-renderer.ts';

/** DAW-style cold seek: restore channel state and sounding keys, without running past DSP. */
export function chaseMidiAudioEvents(events: readonly MidiBlockEvent[], start: number): MidiBlockEvent[] {
	const state: MidiBlockEvent[] = [], sustain = new Set<number>(), sostenuto = new Set<number>();
	const voices: { data: readonly number[]; held: boolean; captured: boolean }[] = [];
	const prune = (channel: number) => {
		for (let index = voices.length - 1; index >= 0; index--) {
			const voice = voices[index]!;
			if ((voice.data[0]! & 15) === channel && !voice.held && !sustain.has(channel) && !(voice.captured && sostenuto.has(channel))) voices.splice(index, 1);
		}
	};
	for (const event of events) {
		if (event.frame >= start) break;
		const [status, first, second] = event.data, channel = status! & 15, type = status! & 240;
		if (type === 0x90 && second) { voices.push({ data: event.data, held: true, captured: false }); continue; }
		if (type === 0x80 || type === 0x90) {
			const voice = voices.find(value => value.held && (value.data[0]! & 15) === channel && value.data[1] === first);
			if (voice) voice.held = false; prune(channel); continue;
		}
		state.push({ frame: 0, data: event.data });
		if (type !== 0xb0) continue;
		if (first === 64) { if (second! >= 64) sustain.add(channel); else sustain.delete(channel); }
		if (first === 66) {
			if (second! >= 64 && !sostenuto.has(channel)) {
				sostenuto.add(channel); for (const voice of voices) if ((voice.data[0]! & 15) === channel && voice.held) voice.captured = true;
			} else if (second! < 64) sostenuto.delete(channel);
		}
		if (first === 121) { sustain.delete(channel); sostenuto.delete(channel); }
		if (first === 120 || first === 123) for (const voice of voices) if ((voice.data[0]! & 15) === channel) { voice.held = false; if (first === 120) voice.captured = false; }
		if (first === 120) for (let index = voices.length - 1; index >= 0; index--) { if ((voices[index]!.data[0]! & 15) === channel) voices.splice(index, 1); }
		prune(channel);
	}
	const captured = voices.filter(voice => voice.captured && sostenuto.has(voice.data[0]! & 15));
	for (const channel of sostenuto) state.push({ frame: 0, data: [0xb0 | channel, 66, 0] });
	for (const voice of captured) state.push({ frame: 0, data: voice.data });
	for (const channel of sostenuto) state.push({ frame: 0, data: [0xb0 | channel, 66, 127] });
	for (const voice of voices) if (!captured.includes(voice)) state.push({ frame: 0, data: voice.data });
	for (const voice of voices) if (!voice.held) state.push({ frame: 0, data: [0x80 | voice.data[0]! & 15, voice.data[1]!, 0] });
	return state;
}

export interface MidiAudioEventTimeline { readonly frames: Float64Array<ArrayBuffer>; readonly messages: Uint32Array<ArrayBuffer> }
export function compileMidiAudioTimeline(data: MidiClipData, start = 0): MidiAudioEventTimeline {
	const all = midiAudioEvents(data);
	const events = start ? [...chaseMidiAudioEvents(all, start), ...all.filter(event => event.frame >= start).map(event => ({ ...event, frame: event.frame - start }))] : all;
	return { frames: Float64Array.from(events.map(event => event.frame)), messages: Uint32Array.from(events.map(event =>
		event.data[0]! | (event.data[1] ?? 0) << 8 | (event.data[2] ?? 0) << 16 | event.data.length << 24)) };
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
