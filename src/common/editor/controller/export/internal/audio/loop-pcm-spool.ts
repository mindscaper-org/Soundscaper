/* SPDX-License-Identifier: AGPL-3.0-only */

const CHUNK_FRAMES = 16_384;

/** Read one loop from a file-backed render, folding its remainder with bounded PCM memory. */
export async function* readLoopPcmSpool(
	blob: Blob, channelCount: number, loopFrames: number, assertCurrent: () => void,
): AsyncGenerator<readonly Float32Array[]> {
	const frameBytes = channelCount * Float32Array.BYTES_PER_ELEMENT;
	const totalFrames = blob.size / frameBytes;
	if (!Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 32
		|| !Number.isSafeInteger(loopFrames) || loopFrames < 1
		|| !Number.isSafeInteger(totalFrames) || totalFrames < loopFrames) {
		throw new RangeError('Loop PCM spool geometry is invalid.');
	}
	const read = async (offset: number, frames: number) => {
		assertCurrent();
		const bytes = await blob.slice(offset * frameBytes, (offset + frames) * frameBytes).arrayBuffer();
		assertCurrent();
		return new Float32Array(bytes);
	};
	if (loopFrames <= CHUNK_FRAMES) {
		// Short loops may repeat thousands of times within a tail. Read sequentially
		// so a one-frame loop never causes one filesystem read per tail sample.
		const channels = Array.from({ length: channelCount }, () => new Float32Array(loopFrames));
		for (let offset = 0; offset < totalFrames; offset += CHUNK_FRAMES) {
			const frames = Math.min(CHUNK_FRAMES, totalFrames - offset);
			const pcm = await read(offset, frames);
			for (let frame = 0; frame < frames; frame += 1) {
				for (let channel = 0; channel < channelCount; channel += 1) {
					const target = (offset + frame) % loopFrames;
					const sample = pcm[frame * channelCount + channel]!;
					channels[channel]![target] = offset + frame < loopFrames ? sample : channels[channel]![target]! + sample;
				}
			}
		}
		yield channels;
		return;
	}
	for (let start = 0; start < loopFrames; start += CHUNK_FRAMES) {
		const frames = Math.min(CHUNK_FRAMES, loopFrames - start);
		const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
		for (let offset = start; offset < totalFrames; offset += loopFrames) {
			const available = Math.min(frames, totalFrames - offset);
			const pcm = await read(offset, available);
			for (let frame = 0; frame < available; frame += 1) {
				for (let channel = 0; channel < channelCount; channel += 1) {
					const sample = pcm[frame * channelCount + channel]!;
					channels[channel]![frame] = offset === start ? sample : channels[channel]![frame]! + sample;
				}
			}
		}
		yield channels;
	}
}
