/* SPDX-License-Identifier: AGPL-3.0-only */
import { midiAudioEvents } from './engine/midi-audio-events.ts';
import { splitMidiInstrumentPorts } from './engine/midi-instrument-ports.ts';
import type { MidiClipData } from './midi-model.ts';

interface Voice { readonly key: number; held: boolean; captured: boolean; released: number | null }

/** Source trims cannot recreate a released sostenuto voice by sending its pedal before Note On. */
export function createMidiSostenutoProjectionAdmission(data: MidiClipData) {
	const spans: [number, number][] = [];
	if (data.interchange?.events.some(event => (event.status & 240) === 176 && event.data[0] === 66 && event.data[1]! >= 64)) {
		for (const part of splitMidiInstrumentPorts(data)) {
			const channels = Array.from({ length: 16 }, () => ({ down: false, voices: [] as Voice[] }));
			const finish = (voice: Voice, frame: number) => {
				if (voice.released !== null && frame > voice.released) spans.push([voice.released, frame]);
				voice.captured = false; voice.released = null;
			};
			for (const event of midiAudioEvents(part)) {
				const [status, key, value] = event.data, type = status! & 240, channel = channels[status! & 15]!;
				if (type === 144 && value) { channel.voices.push({ key: key!, held: true, captured: false, released: null }); continue; }
				if (type === 128 || type === 144 || type === 176 && key! >= 123 && key! <= 127) {
					for (const voice of channel.voices) if (voice.held && (type === 176 || voice.key === key)) {
						voice.held = false;
						if (voice.captured && channel.down) voice.released = event.frame;
					}
				} else if (type === 176 && key === 66) {
					if (value! >= 64 && !channel.down) for (const voice of channel.voices) if (voice.held) voice.captured = true;
					if (value! < 64) for (const voice of channel.voices) finish(voice, event.frame);
					channel.down = value! >= 64;
				} else if (type === 176 && [120, 121].includes(key!)) {
					for (const voice of channel.voices) finish(voice, event.frame);
					if (key === 120) channel.voices = []; else channel.down = false;
				}
				channel.voices = channel.voices.filter(voice => voice.held || voice.captured);
			}
			for (const channel of channels) for (const voice of channel.voices) finish(voice, Infinity);
		}
	}
	const merged: [number, number][] = [];
	for (const span of spans.sort(([a], [b]) => a - b)) {
		const previous = merged.at(-1);
		if (previous && span[0] <= previous[1]) previous[1] = Math.max(previous[1], span[1]); else merged.push([...span]);
	}
	return (start: number, frames: number, reversed: boolean): void => {
		let low = 0, high = merged.length;
		while (low < high) { const middle = (low + high) >>> 1; if (merged[middle]![1] <= start) low = middle + 1; else high = middle; }
		const span = merged[low];
		if (span && (reversed ? span[0] < start + frames : span[0] <= start)) {
			throw new RangeError('MIDI delivery cannot preserve this cut or reversed sostenuto-held voice. Export audio or save the native project.');
		}
	};
}
