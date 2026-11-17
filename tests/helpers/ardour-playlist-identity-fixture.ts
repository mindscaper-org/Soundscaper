/* SPDX-License-Identifier: AGPL-3.0-only */
export function ardourPlaylistIdentitySession(legacy: boolean, collision = true): string {
	const activeId = legacy ? 31 : 30, alternateId = legacy ? 30 : 31;
	const activeName = legacy ? '30' : 'Programme', alternateName = !legacy && collision ? '30' : 'Alternate';
	const route = legacy ? '<Route id="20" name="Dialogue" default-type="audio"><Diskstream playlist="30"/></Route>'
		: '<Route id="20" name="Dialogue" default-type="audio" audio-playlist="30"/>';
	const region = (id: number, start: number) => `<Region id="${id}" name="${start ? 'Wrong take' : 'Programme'}" type="audio" source-0="10" channels="1" position="0" start="${start}" length="2400"/>`;
	return `<Session version="${legacy ? 5000 : 7002}" name="Playlist namespace" sample-rate="48000"><Sources><Source id="10" name="voice.wav" type="audio" channel="0"/></Sources><Routes>${route}</Routes><Playlists>
<Playlist id="${activeId}" name="${activeName}" type="audio" orig-track-id="20">${region(40, 0)}</Playlist>
<Playlist ${collision || !legacy ? `id="${alternateId}"` : 'id="32"'} name="${alternateName}" type="audio">${region(41, 2400)}</Playlist>
</Playlists></Session>`;
}
