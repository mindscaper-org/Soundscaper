/* SPDX-License-Identifier: AGPL-3.0-only */
export function ardourExternalOriginSession(origin?: string): string {
	const attribute = origin === undefined ? '' : `origin="${origin.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`;
	return `<Session version="7002" name="Linked session" sample-rate="48000"><Sources>
<Source id="10" name="Stereo.wav" ${attribute} type="audio" channel="0"/>
</Sources><Routes><Route id="20" name="Dialogue" default-type="audio" audio-playlist="30"/></Routes><Playlists><Playlist id="30" name="Dialogue" type="audio" orig-track-id="20">
<Region id="40" name="External recording" source-0="10" channels="1" position="0" start="0" length="4800"/>
</Playlist></Playlists></Session>`;
}
