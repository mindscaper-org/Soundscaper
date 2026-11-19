/* SPDX-License-Identifier: AGPL-3.0-only */
export function dawprojectGenericDeviceXml(device: string, automation = ''): string {
	return `<Project version="1.0"><Application name="Fixture" version="1"/>
<Structure><Track id="track" name="Voice" contentType="audio"><Channel id="channel" role="regular" audioChannels="1"><Devices>${device}</Devices></Channel></Track></Structure>
<Arrangement><Lanes timeUnit="seconds"><Lanes track="track"><Clips><Clip time="0" duration="1" contentTimeUnit="seconds"><Audio timeUnit="seconds" duration="1" sampleRate="48000" channels="1"><File path="voice.wav"/></Audio></Clip></Clips>${automation}</Lanes></Lanes></Arrangement></Project>`;
}

export const indexedHighPassDevice = '<Equalizer deviceRole="audioFX" deviceName="EQ"><Band type="highPass" order="0"><Freq value="1000" unit="hertz"/></Band></Equalizer>';
