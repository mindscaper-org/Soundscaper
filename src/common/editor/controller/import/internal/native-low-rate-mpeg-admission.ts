/* SPDX-License-Identifier: AGPL-3.0-only */
import { raceAbortableRead } from '../../../../foundation/abort-race.ts';
import { inspectMp3GaplessGeometry } from '../../../mp3-gapless-import.ts';

const BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** Native whole-file decoding avoids unreliable low-rate packet decoder timestamps. */
export async function nativeLowRateMpegAdmission(file: Blob, offset: number, signal?: AbortSignal) {
	if (file.size > 32 * 1024 ** 2) return null;
	const gapless = await raceAbortableRead(() => inspectMp3GaplessGeometry(file), signal);
	if (!gapless || gapless.sampleRate >= 32_000) return null;
	let packets = 0, channelCount = 0;
	while (offset < file.size) {
		const bytes = new Uint8Array(await raceAbortableRead(() => file.slice(offset, offset + 4).arrayBuffer(), signal));
		if (bytes.length !== 4 || bytes[0] !== 255 || (bytes[1]! & 0xe6) !== 0xe2
			|| (bytes[1]! >> 3 & 3) === 1 || (bytes[1]! >> 3 & 3) === 3 || (bytes[3]! & 3) === 2) return null;
		const rate = [44_100, 48_000, 32_000][bytes[2]! >> 2 & 3];
		const sampleRate = rate && rate / ((bytes[1]! >> 3 & 3) === 2 ? 2 : 4);
		const channels = bytes[3]! >> 6 === 3 ? 1 : 2;
		const bitrate = BITRATES[bytes[2]! >> 4];
		if (!sampleRate || !bitrate || sampleRate !== gapless.sampleRate || channelCount && channels !== channelCount) return null;
		channelCount = channels;
		const byteLength = Math.floor(72_000 * bitrate / sampleRate) + (bytes[2]! >> 1 & 1);
		if (byteLength > file.size - offset) return null;
		offset += byteLength;
		packets += 1;
		if (packets % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
	}
	// The first Xing/Info frame is metadata and is excluded from its packet count.
	if ((packets - 1) * 576 !== gapless.encodedFrames || gapless.sourceFrames * channelCount * 4 > 128 * 1024 ** 2) return null;
	return Object.freeze({ sampleRate: gapless.sampleRate, decodeSampleRate: gapless.sampleRate,
		channelCount, frameCount: gapless.sourceFrames,
		trimNativeMpeg: { encodedFrames: gapless.encodedFrames, leadingFrames: gapless.leadingFrames } });
}
