/* SPDX-License-Identifier: AGPL-3.0-only */
export function sesxSoloSafeSession(solo: boolean, safe: boolean, muted: boolean) {
	return `<sesx><session sampleRate="48000" audioChannelType="stereo"><tracks>
<audioTrack><trackParameters><name>Solo</name></trackParameters><trackAudioParameters audioChannelType="mono" solo="${String(solo)}"/></audioTrack>
<audioTrack><trackParameters><name>Programme</name></trackParameters>
<trackAudioParameters audioChannelType="mono" solo="false" soloSafe="${String(safe)}">
<component id="trackPan"><parameter name="Pan" parameterValue="-1"/></component>
<component id="trackMute"><parameter name="mute" parameterValue="${muted ? 1 : 0}"/></component>
</trackAudioParameters>
<audioClip fileID="0" startPoint="0" endPoint="4800" sourceInPoint="0" sourceOutPoint="4800"/>
</audioTrack></tracks></session><files><file id="0" relativePath="Stereo.wav"/></files></sesx>`;
}
