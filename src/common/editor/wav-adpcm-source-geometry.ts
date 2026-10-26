/* SPDX-License-Identifier: AGPL-3.0-only */

interface WavAdpcmSourceGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly decodedFrameCount: number;
}

/** Complete standard MS ADPCM blocks with an authoritative final-block fact count. */
export function inspectWavAdpcmSourceGeometry(bytes: Uint8Array): WavAdpcmSourceGeometry | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length < 90 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE'
		|| view.getUint32(4, true) !== bytes.length - 8) return null;
	let format: number | null = null, frameCount: number | null = null, dataBytes: number | null = null;
	let offset = 12;
	for (let chunks = 0; offset < bytes.length; chunks++) {
		if (chunks >= 4096 || offset + 8 > bytes.length) return null;
		const id = ascii(bytes, offset), size = view.getUint32(offset + 4, true), payload = offset + 8;
		if (payload + size + (size & 1) > bytes.length) return null;
		if (id === 'fmt ') { if (format !== null || size !== 50) return null; format = payload; }
		else if (id === 'fact') { if (frameCount !== null || size !== 4) return null; frameCount = view.getUint32(payload, true); }
		else if (id === 'data') { if (dataBytes !== null) return null; dataBytes = size; }
		offset = payload + size + (size & 1);
	}
	if (format === null || !frameCount || !dataBytes) return null;
	const channelCount = view.getUint16(format + 2, true), sampleRate = view.getUint32(format + 4, true);
	const blockAlign = view.getUint16(format + 12, true), samplesPerBlock = view.getUint16(format + 18, true);
	if (view.getUint16(format, true) !== 2 || channelCount < 1 || channelCount > 2
		|| sampleRate < 3000 || sampleRate > 384_000 || view.getUint16(format + 14, true) !== 4
		|| view.getUint16(format + 16, true) !== 32 || view.getUint16(format + 20, true) !== 7
		|| blockAlign <= 7 * channelCount || dataBytes % blockAlign !== 0
		|| samplesPerBlock !== (blockAlign - 7 * channelCount) * 2 / channelCount + 2
		|| view.getUint32(format + 8, true) !== Math.floor(sampleRate * blockAlign / samplesPerBlock)) return null;
	const coefficients = [256, 0, 512, -256, 0, 0, 192, 64, 240, 0, 460, -208, 392, -232];
	if (coefficients.some((coefficient, index) => view.getInt16(format + 22 + index * 2, true) !== coefficient)) return null;
	const decodedFrameCount = dataBytes / blockAlign * samplesPerBlock;
	if (frameCount > decodedFrameCount || frameCount <= decodedFrameCount - samplesPerBlock) return null;
	return { sampleRate, channelCount, frameCount, decodedFrameCount };
}

function ascii(bytes: Uint8Array, offset: number): string { return String.fromCharCode(...bytes.subarray(offset, offset + 4)); }
