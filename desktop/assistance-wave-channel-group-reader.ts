/* SPDX-License-Identifier: AGPL-3.0-only */

import { ASSISTANCE_WAVE_PCM_WINDOW_MAXIMUM_BYTES,
	type AssistanceFloat32WaveSourceV1,
	type AssistanceFloat32WaveReadRequestV1 } from './assistance-streaming-float32-wave.ts';

/** Private, sequential chunk custody: readers copy the selected planes into model input. */
export function prepareAssistanceWaveChannelGroup(
	source: AssistanceFloat32WaveSourceV1,
): AssistanceFloat32WaveSourceV1 {
	const ranges = new Map<string, readonly Float32Array[]>();
	let retainedBytes = 0;
	let reading = false;
	return Object.freeze({ geometry: source.geometry,
		async readFrames(request: AssistanceFloat32WaveReadRequestV1, signal?: AbortSignal) {
			signal?.throwIfAborted();
			const { startFrame, frameCount, channelStart, channelCount } = request;
			if (![startFrame, frameCount, channelStart, channelCount].every(Number.isSafeInteger)
				|| startFrame < 0 || frameCount < 1 || startFrame + frameCount > source.geometry.frameCount
				|| channelStart < 0 || channelCount < 1
				|| channelStart + channelCount > source.geometry.channelCount) {
				throw new RangeError('The assistance channel group range is outside its exact geometry.');
			}
			const byteLength = frameCount * source.geometry.channelCount * Float32Array.BYTES_PER_ELEMENT;
			if (!Number.isSafeInteger(byteLength) || byteLength > ASSISTANCE_WAVE_PCM_WINDOW_MAXIMUM_BYTES) {
				throw new RangeError('The assistance WAV PCM window exceeds its bounded range capacity.');
			}
			const key = `${startFrame}:${frameCount}`;
			let channels = ranges.get(key);
			if (!channels) {
				if (reading) throw new Error('An owned assistance chunk reads its channel groups sequentially.');
				if (ranges.size >= 3 || retainedBytes + byteLength > ASSISTANCE_WAVE_PCM_WINDOW_MAXIMUM_BYTES) {
					ranges.clear(); retainedBytes = 0;
				}
				reading = true;
				try {
					channels = await source.readFrames({ startFrame, frameCount, channelStart: 0,
						channelCount: source.geometry.channelCount }, signal);
					signal?.throwIfAborted();
					ranges.set(key, channels); retainedBytes += byteLength;
				} finally { reading = false; }
			}
			return Object.freeze(channels.slice(channelStart, channelStart + channelCount));
		},
		async close() { ranges.clear(); retainedBytes = 0; await source.close(); },
	});
}
