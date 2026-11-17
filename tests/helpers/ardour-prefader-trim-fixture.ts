/* SPDX-License-Identifier: AGPL-3.0-only */
export function ardourPrefaderTrimSession(trimAutomated: boolean, sendAutomated: boolean, trimEnabled = true, discrete: 'trim' | 'send' | null = null): string {
	const curve = (enabled: boolean, owner: 'trim' | 'send') => enabled ? `<Automation><AutomationList automation-id="gain" state="Play" interpolation-style="${discrete === owner ? 'Discrete' : 'Linear'}"><events>0 .5\n${discrete === owner ? 24000 : 48000} 1</events></AutomationList></Automation>` : '';
	return `<Session version="7002" name="Trimmed cue" sample-rate="48000">
<Sources><Source id="10" name="voice.wav" type="audio" channel="0"/></Sources>
<Routes><Route id="20" name="Dialogue" default-type="audio" audio-playlist="30">
<IO direction="Output"><Port name="Dialogue/audio_out 1" type="audio"/></IO>
<Processor type="trim" active="${trimEnabled ? 1 : 0}"><Controllable name="gaincontrol" value="0.5"/>${curve(trimAutomated, 'trim')}</Processor>
<Processor type="intsend" active="1" send-to="99"><Amplifier><Controllable name="gaincontrol" value="0.5"/>${curve(sendAutomated, 'send')}</Amplifier></Processor>
<Processor type="amp" active="1"><Controllable name="gaincontrol" value="0.25"/></Processor>
</Route><Route id="99" name="Cue"><Pannable><Controllable name="pan-azimuth" value="0"/></Pannable><Processor type="amp"><Controllable name="gaincontrol" value="1"/></Processor></Route></Routes>
<Playlists><Playlist id="30" name="Dialogue" type="audio" orig-track-id="20"><Region id="40" name="Phrase" type="audio" source-0="10" channels="1" position="0" start="0" length="48000" scale-amplitude="1" muted="0"/></Playlist></Playlists>
</Session>`;
}
