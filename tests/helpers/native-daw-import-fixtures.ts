/* SPDX-License-Identifier: AGPL-3.0-only */

/** Independently authored from Ardour's Session/Route/Playlist vocabulary. */
export function ardourSession(modern = false): string {
	return `<?xml version="1.0"?><Session version="${modern ? '7002' : '6000'}" name="Native session" sample-rate="48000">
	<Sources><Source id="10" name="voice.wav" type="audio" channel="0"/></Sources>
	<Routes><Route id="20" name="Dialogue" default-type="audio" audio-playlist="30">
	<PresentationInfo order="1"/><Controllable name="mute" value="0"/><Controllable name="solo" value="1"/>
	<Processor type="amp"><Controllable name="gaincontrol" value="0.5"/></Processor>
	<Pannable><Controllable name="pan-azimuth" value="0.25"/></Pannable></Route></Routes>
	<Playlists><Playlist id="30" name="Dialogue.1" type="audio" orig-track-id="20">
	<Region id="40" name="Phrase" type="audio" source-0="10" channels="1" position="${modern ? 'a141120000' : '24000'}"
	start="${modern ? 'a70560000' : '12000'}" length="${modern ? 'a141120000@a141120000' : '24000'}" scale-amplitude="0.75" muted="0"/>
	</Playlist><Playlist id="31" name="Alternate take" type="audio" orig-track-id="20">
	<Region source-0="10" position="0" start="0" length="48000"/></Playlist></Playlists></Session>`;
}

/** SoundCraft serde v1: numeric newtype IDs and externally tagged ClipContent. */
export function soundcraftSession() {
	return {
		format_version: 1, name: 'Native session', sample_rate: 48000, frame_rate: 'Fps25', timecode_start: 0,
		sources: [{ id: 10, name: 'Voice', path: 'Audio Files/voice.wav', channels: 1, frames: 48000, sample_rate: 48000, format: 'Wav' }],
		tracks: [{ id: 20, name: 'Dialogue', kind: 'Audio', format: 'Mono', active_playlist: 1,
			mixer: { volume_db: -6, trim_db: 0, pan: [-0.5], mute: false, solo: true, output: 'Main', inserts: [], sends: [] },
			playlists: [{ name: 'Unused', clips: [] }, { name: 'Active', clips: [{ id: 40, name: 'Phrase', start: 24000, length: 24000,
				content: { Audio: { source: 10, offset: 12000 } }, gain_db: -3,
				fade_in: { len: 240, shape: 'Linear', curvature: 0 }, fade_out: { len: 480, shape: 'EqualPower', curvature: 0 } }] }],
		}],
	};
}
