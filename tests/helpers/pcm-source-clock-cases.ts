/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav } from '../../src/common/editor/wav.js';

/** Distinct PCM controls formerly repeated inside unrelated codec specs. */
export function pcmSourceClockCases() {
	return ([
		[16_000, 1, 4800, true], [32_000, 1, 4800, true],
		[32_000, 2, 4800, true], [32_000, 2, 18_816, true],
		[48_000, 1, 4800, true], [48_000, 2, 4800, true],
		[96_000, 2, 4800, true], [48_000, 1, 4800, false],
	] as const).map(([sampleRate, channelCount, frameCount, float]) => {
		const id = `${sampleRate}-${channelCount}-${frameCount}-${float ? 'float32' : 'pcm16'}`;
		const channels = Array.from({ length: channelCount }, (_, channel) => new Float32Array(frameCount).fill(channel ? -.0625 : .125));
		const bytes = encodeWav(channels, { sampleRate, float, bitDepth: float ? 32 : 16, dither: false });
		return { id, sampleRate, channelCount, frameCount, channels,
			file: new File([Uint8Array.from(bytes)], `${id}.wav`, { type: 'audio/wav' }) };
	});
}
