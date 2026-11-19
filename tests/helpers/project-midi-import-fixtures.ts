/* SPDX-License-Identifier: AGPL-3.0-only */

import { soundcraftSession } from './native-daw-import-fixtures.ts';

/** Literal serde fields from the pinned craft-midis Sequence model (960 PPQ). */
export function soundcraftMidiSession() {
	const audio = soundcraftSession();
	return { ...audio, tempo: { tempos: [{ tick: 0, bpm: 120 }, { tick: 1920, bpm: 60 }], meters: [{ tick: 0, numerator: 4, denominator: 4 }] },
		tracks: [audio.tracks[0]!, { id: 21, name: 'Keys', kind: 'Instrument', active_playlist: 0, mixer: audio.tracks[0]!.mixer,
			playlists: [{ clips: [{ id: 41, name: 'MIDI phrase', start: 24000, length: 96000, gain_db: -3, muted: false,
				content: { Midi: { sequence: {
					notes: [{ pitch: 64, velocity: 100, release_velocity: 32, channel: 2, start: 960, length: 1920 }],
					ctrls: [{ tick: 0, channel: 2, kind: 'Program', value: 12 }, { tick: 960, channel: 2, kind: { Cc: 64 }, value: 127 }],
				} } } }] }] }] as const };
}

/** Modern Ardour beat coordinates: b values use 1920 ticks per quarter. */
export function ardourMidiSession(tempo = '<Tempo npm="120" enpm="120" note-type="4" quarters="0:0" sclock="0"/>') {
	return `<Session version="7002" name="Notes" sample-rate="48000">
	<Sources><Source id="10" name="keys.mid" type="midi"/></Sources>
	<TempoMap superclocks-per-second="282240000"><Tempos>${tempo}</Tempos></TempoMap>
	<Routes><Route id="20" name="Keys" default-type="midi" midi-playlist="30"/></Routes>
	<Playlists><Playlist id="30" type="midi" orig-track-id="20"><Region id="40" name="MIDI phrase" type="midi"
	 source-0="10" position="b3840" start="b1920" length="b3840@b3840"/></Playlist></Playlists></Session>`;
}

/** Independently encoded SMF: 480 PPQ, program, sustain, one note and release. */
export function ardourMidiBytes(): Uint8Array<ArrayBuffer> {
	const track = [0, 0xc2, 12, 0, 0xb2, 64, 127, 0x83, 0x60, 0x92, 64, 100, 0x83, 0x60, 0x82, 64, 32,
		0x83, 0x60, 0xb2, 64, 0, 0x83, 0x60, 0xff, 0x2f, 0];
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, track.length, ...track]);
}
