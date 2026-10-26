/* SPDX-License-Identifier: AGPL-3.0-only */

interface IrcamPcmSourceGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

/** Complete libsndfile IRCAM little-endian PCM16 mono/stereo recordings. */
export function inspectIrcamPcmSourceGeometry(bytes: Uint8Array): IrcamPcmSourceGeometry | null {
	if (bytes.length <= 1024 || bytes[0] !== 0x64 || bytes[1] !== 0xa3 || bytes[2] !== 3 || bytes[3] !== 0) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const sampleRate = view.getFloat32(4, true);
	const channelCount = view.getUint32(8, true);
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 3000 || sampleRate > 384_000
		|| ![1, 2].includes(channelCount) || view.getUint32(12, true) !== 2) return null;
	const dataBytes = bytes.length - 1024;
	if (dataBytes % (channelCount * 2) !== 0) return null;
	return Object.freeze({ sampleRate, channelCount, frameCount: dataBytes / (channelCount * 2) });
}
