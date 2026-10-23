/* SPDX-License-Identifier: AGPL-3.0-only */

export type LegacyAupEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

/** Identical Audacity XML/AU content in the XML processor's required byte encodings. */
export function legacyAupFiles(encoding: LegacyAupEncoding): Readonly<{ projectFile: File; dataFile: File }> {
	const xml = `<?xml version="1.0" encoding="${encoding === 'utf-8' ? 'UTF-8' : 'UTF-16'}"?>
<project rate="48000" projname="Été 演奏 🎙.aup">
<wavetrack name="Voix 日本語 🎙" channel="2" rate="48000">
<waveclip offset="0"><sequence numsamples="4800"><waveblock start="0"><simpleblockfile filename="e0000.au" len="4800"/></waveblock></sequence></waveclip>
</wavetrack><labeltrack name="Repères"><label t="0.025" t1="0.05" title="Repère 日本語 🎵"/></labeltrack>
</project>`;
	let bytes: Uint8Array<ArrayBuffer>;
	if (encoding === 'utf-8') bytes = new TextEncoder().encode(xml);
	else {
		bytes = new Uint8Array((xml.length + 1) * 2);
		const view = new DataView(bytes.buffer);
		const little = encoding === 'utf-16le';
		view.setUint16(0, 0xfeff, little);
		for (let index = 0; index < xml.length; index++) view.setUint16((index + 1) * 2, xml.charCodeAt(index), little);
	}
	const au = new Uint8Array(24 + 4800 * 4);
	const view = new DataView(au.buffer);
	for (const [index, value] of [0x2e736e64, 24, 4800 * 4, 6, 48_000, 1].entries()) view.setUint32(index * 4, value);
	for (let index = 0; index < 4800; index++) view.setFloat32(24 + index * 4, index % 2 ? -0.25 : 0.25);
	return Object.freeze({ projectFile: new File([bytes.buffer], 'Été 演奏 🎙.aup', { type: 'application/x-audacity-project' }),
		dataFile: new File([au.buffer], 'e0000.au') });
}
