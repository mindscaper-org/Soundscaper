/* SPDX-License-Identifier: AGPL-3.0-only */

import { dawArray, dawInteger, dawNumber, dawRecord } from './native-daw-import-values.ts';
import { createInterchangeMidiClock } from './interchange-midi-clock.ts';
import { normalizeMidiClipData, type MidiClipData } from './midi-model.ts';
import { midiFileInteger, type MidiFileEvent } from './midi-file-types.ts';
import type { Rational } from './timeline-time.ts';

/** craft-midis Sequence ticks use 960 PPQ, anchored at the clip's sample origin. */
export function readSoundcraftMidi(sequence: unknown, tempo: unknown, start: Rational, sampleRate: number): MidiClipData {
	const entries = tempo === undefined ? [{ tick: 0, bpm: 120 }] : dawArray(dawRecord(tempo).tempos);
	const clock = createInterchangeMidiClock(entries.map(value => {
		const entry = dawRecord(value);
		return { beat: dawInteger(entry.tick, 'SoundCraft tempo tick') / 960, bpm: dawNumber(entry.bpm, NaN) };
	}));
	const origin = clock.beatAt(start), input = dawRecord(sequence);
	const frameAt = (tick: unknown): number => clock.frameAt(origin + dawInteger(tick, 'SoundCraft MIDI tick') / 960, sampleRate, start);
	const notes = dawArray(input.notes).map((value, index) => {
		const note = dawRecord(value), tick = dawInteger(note.start, 'SoundCraft note tick'), length = dawInteger(note.length, 'SoundCraft note length', 1);
		if (!Number.isSafeInteger(tick + length)) throw new RangeError('SoundCraft MIDI note end exceeds the tick range.');
		const startFrame = frameAt(tick);
		return { id: `soundcraft-note-${index}`, pitch: note.pitch, velocity: note.velocity, releaseVelocity: note.release_velocity,
			channel: note.channel, startFrame, durationFrames: Math.max(1, frameAt(tick + length) - startFrame) };
	});
	const events = dawArray(input.ctrls ?? []).map(value => {
		const event = dawRecord(value), channel = midiFileInteger(dawInteger(event.channel, 'SoundCraft MIDI channel'), 0, 15, 'channel');
		const byte = (value: unknown) => midiFileInteger(dawInteger(value, 'SoundCraft MIDI controller data'), 0, 127, 'controller data');
		let status: number, data: number[];
		if (event.kind === 'PitchBend') {
			const bend = midiFileInteger(dawInteger(event.value, 'SoundCraft MIDI pitch bend', -8192), -8192, 8191, 'pitch bend') + 8192;
			status = 0xe0; data = [bend & 127, bend >> 7];
		} else if (event.kind === 'Program' || event.kind === 'ChannelPressure') {
			status = event.kind === 'Program' ? 0xc0 : 0xd0; data = [byte(event.value)];
		} else {
			const kind = dawRecord(event.kind);
			if (Object.keys(kind).length !== 1 || !('Cc' in kind || 'PolyPressure' in kind)) throw new RangeError('Unsupported SoundCraft MIDI controller.');
			status = 'Cc' in kind ? 0xb0 : 0xa0; data = [byte(kind.Cc ?? kind.PolyPressure), byte(event.value)];
		}
		return { frame: frameAt(event.tick), status: status | channel, data } satisfies MidiFileEvent;
	}).sort((a, b) => a.frame - b.frame);
	return normalizeMidiClipData({ version: 1, notes, interchange: { events, tempos: [], signatures: [] } });
}
