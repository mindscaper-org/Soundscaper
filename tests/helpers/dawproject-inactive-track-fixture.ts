/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

export async function inactiveDawprojectTrackFile(options: Readonly<{
	loaded?: boolean; role?: 'regular' | 'submix' | 'effect' | 'master'; folder?: boolean; mute?: boolean; solo?: boolean; muteAutomation?: boolean;
}> = {}): Promise<File> {
	const channel = `<Channel id="channel" role="${options.role ?? 'regular'}" solo="${options.solo ?? false}">
		<Volume value="1" unit="linear"/><Mute id="mute" value="${options.mute ?? false}"/></Channel>`;
	const loaded = options.loaded === undefined ? '' : `loaded="${options.loaded}"`;
	const track = options.folder
		? `<Track id="voice" name="Voice" contentType="tracks" ${loaded}>${channel}
			<Track id="child" name="Child" contentType="audio"><Channel role="regular"/></Track></Track>`
		: `<Track id="voice" name="Voice" contentType="audio" ${loaded}>${channel}</Track>`;
	const pcm = encodeWav([new Float32Array(48_000).fill(0.5)], { sampleRate: 48_000, float: true });
	assert.ok(pcm instanceof Uint8Array);
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>',
		files: [{ path: 'voice.wav', blob: new Blob([Uint8Array.from(pcm)]) }],
		projectXml: `<Project version="1.0"><Structure>${track}</Structure><Arrangement><Lanes timeUnit="seconds">
			<Lanes track="voice"><Clips><Clip time="0" duration="1" contentTimeUnit="seconds">
			<Audio timeUnit="seconds" duration="1" sampleRate="48000" channels="1"><File path="voice.wav"/></Audio>
			</Clip></Clips>${options.muteAutomation ? '<Points><Target parameter="mute"/><BoolPoint time="0" value="false"/></Points>' : ''}
			</Lanes></Lanes></Arrangement></Project>`,
	});
	return new File([archive], 'Track state.dawproject', { type: 'application/zip' });
}
