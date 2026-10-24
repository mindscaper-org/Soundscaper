/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticate an unprefixed modern APE clock; native decoding owns PCM, CRC and tags. */
export function inspectApeAudioSampleRate(bytes: Uint8Array): number | null {
	if (bytes.length < 84 || bytes[0] !== 77 || bytes[1] !== 65 || bytes[2] !== 67 || bytes[3] !== 32) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint16(4, true) !== 3990 || view.getUint16(6, true) !== 0
		|| view.getUint32(8, true) !== 52 || view.getUint32(12, true) !== 24 || view.getUint32(28, true) !== 0) return null;
	const compression = view.getUint16(52, true), flags = view.getUint16(54, true);
	const packetFrames = view.getUint32(56, true), finalFrames = view.getUint32(60, true), packets = view.getUint32(64, true);
	const channels = view.getUint16(70, true), sampleRate = view.getUint32(72, true);
	if (![1000, 2000, 3000, 4000, 5000].includes(compression) || ![0, 32].includes(flags)
		|| packetFrames !== 73728 * (compression === 4000 ? 4 : compression === 5000 ? 16 : 1)
		|| !finalFrames || finalFrames > packetFrames || !packets || packets > 1_000_000
		|| view.getUint16(68, true) !== 16 || ![1, 2].includes(channels) || sampleRate < 3000 || sampleRate > 384_000) return null;
	const frames = (packets - 1) * packetFrames + finalFrames;
	if (frames * channels * 4 > 128 * 1024 * 1024 || view.getUint32(16, true) !== packets * 4) return null;
	const headerBytes = view.getUint32(20, true), audioBytes = view.getUint32(24, true);
	const firstPacket = 76 + packets * 4 + headerBytes, audioEnd = firstPacket + audioBytes;
	if (headerBytes > 1024 * 1024 || (flags === 32 ? headerBytes !== 0 : headerBytes === 0)
		|| audioBytes < packets * 4 || audioEnd + view.getUint32(32, true) > bytes.length
		|| firstPacket > bytes.length || view.getUint32(76, true) !== firstPacket) return null;
	let previous = firstPacket;
	for (let index = 1; index < packets; index++) {
		const next = view.getUint32(76 + index * 4, true);
		if (next < previous + 4 || next > audioEnd - 4) return null;
		previous = next;
	}
	return sampleRate;
}
