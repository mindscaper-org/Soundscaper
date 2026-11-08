/* SPDX-License-Identifier: AGPL-3.0-only */
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

export async function nestedDawprojectFadeFile(layers: readonly ('in' | 'out')[]): Promise<File> {
	let content = '<Clip time="0.5" duration="1" contentTimeUnit="seconds"><Audio timeUnit="seconds" duration="1" sampleRate="48000" channels="1"><File path="voice.wav"/></Audio></Clip>';
	for (const layer of [...layers].reverse()) content = `<Clip time="0" duration="3" contentTimeUnit="seconds" fadeTimeUnit="seconds" ${layer === 'in' ? 'fadeInTime="1.5"' : 'fadeOutTime="2.5"'}><Clips>${content}</Clips></Clip>`;
	const projectXml = '<Project version="1.0"><Application name="Other DAW" version="1"/><Structure>'
		+ '<Track id="voice" name="Voice" contentType="audio"><Channel role="regular"><Volume value="1" unit="linear"/></Channel></Track></Structure>'
		+ `<Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips>${content}</Clips></Lanes></Lanes></Arrangement></Project>`;
	const pcm = encodeWav([new Float32Array(48_000).fill(0.5)], { sampleRate: 48_000, float: true });
	if (!(pcm instanceof Uint8Array)) throw new Error('The fade fixture requires complete WAV bytes.');
	const archive = await writeDawprojectArchive({ projectXml, metadataXml: '<MetaData/>', files: [{ path: 'voice.wav', blob: new Blob([Uint8Array.from(pcm)]) }] });
	return new File([archive], 'Nested fades.dawproject', { type: 'application/zip' });
}
