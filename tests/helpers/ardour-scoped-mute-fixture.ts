/* SPDX-License-Identifier: AGPL-3.0-only */
export function ardourScopedMuteSession(points: readonly string[], muted: boolean, postFader: boolean, automated = false, active = true): string {
	const amp = '<Processor type="amp" active="1"><Controllable name="gaincontrol" value="1"/></Processor>';
	const send = '<Processor type="intsend" active="1" send-to="99"><Amplifier><Controllable name="gaincontrol" value="0.5"/></Amplifier></Processor>';
	return `<Session version="7002" name="Scoped mute" sample-rate="48000"><Sources>
<Source id="10" name="voice.wav" type="audio" channel="0"/><Source id="11" name="voice.wav" type="audio" channel="1"/>
</Sources><Routes><Route id="20" name="Dialogue" default-type="audio" audio-playlist="30" active="${active ? 1 : 0}">
<MuteMaster mute-point="${points.join(',') || '0'}" muted="${muted ? 1 : 0}"/>
${automated ? '<Automation><AutomationList automation-id="mute" state="Play" interpolation-style="Discrete"><events>0 0\n2400 1</events></AutomationList></Automation>' : ''}
${postFader ? amp + send : send + amp}</Route><Route id="99" name="Cue">${amp}</Route></Routes>
<Playlists><Playlist id="30" type="audio" orig-track-id="20"><Region id="40" type="audio" source-0="10" source-1="11" channels="2" position="0" start="0" length="4800"/></Playlist></Playlists></Session>`;
}
