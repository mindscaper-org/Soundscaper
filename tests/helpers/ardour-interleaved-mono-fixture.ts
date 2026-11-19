/* SPDX-License-Identifier: AGPL-3.0-only */
export function ardourInterleavedMonoSession(includeStereo = false): string {
	const route = (id: number, stereo: boolean) => `<Route id="${id}" name="${stereo ? 'Stereo' : 'Left only'}" default-type="audio" audio-playlist="${id + 10}"><Pannable><Controllable name="pan-azimuth" value="0"/></Pannable></Route>`;
	const playlist = (id: number, stereo: boolean) => `<Playlist id="${id + 10}" type="audio" orig-track-id="${id}"><Region id="${id + 20}" name="${stereo ? 'Stereo' : 'Left only'}" type="audio" source-0="10" ${stereo ? 'source-1="11" channels="2"' : 'channels="1"'} position="0" start="0" length="4800"/></Playlist>`;
	return `<Session version="7002" name="Interleaved channel views" sample-rate="48000"><Sources>
<Source id="10" name="stereo.wav" type="audio" channel="0"/><Source id="11" name="stereo.wav" type="audio" channel="1"/>
</Sources><Routes>${route(20, false)}${includeStereo ? route(21, true) : ''}</Routes>
<Playlists>${playlist(20, false)}${includeStereo ? playlist(21, true) : ''}</Playlists></Session>`;
}
