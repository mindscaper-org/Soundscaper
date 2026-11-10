/* SPDX-License-Identifier: AGPL-3.0-only */

/** All buffers are fixed before audio starts. The detector needs two periods
 * at 65 Hz; hold programme input by half its window to use a centered estimate.
 * The native processor starts at unity, with one fixed delivery reserve.
 * Keep that latency when controls reach zero so live edits retain rack PDC.
 */
export function autoTuneRealtimeGeometry(sampleRate: number, channelCount: number) {
	if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Auto-Tune sampleRate must be between 8000 and 192000 Hz.');
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) throw new RangeError('Auto-Tune channelCount must be between 1 and 32.');
	const stride = Math.max(1, Math.floor(sampleRate / 8000));
	const analysisFrames = 2 * Math.ceil(sampleRate / stride / 65) * stride;
	const analysisDelayFrames = analysisFrames / 2;
	const fft = 2 ** (11 + Math.round(Math.log2(sampleRate / 44100)));
	const nativeBlockFrames = 128;
	const deliveryFrames = fft / 2 + nativeBlockFrames + 1;
	// The ABI's unity impulse follows its advertised latency by one sample.
	const latencyFrames = analysisDelayFrames + fft - fft / 4 + 3 + deliveryFrames + 1;
	const queueFrames = 2 ** Math.ceil(Math.log2(2 * (fft + deliveryFrames)));
	// Formant sessions use smaller FFTs than plain StaffPad. Reserve 256 bytes
	// per FFT sample per channel pair, plus 16 MiB for runtime and native scratch.
	const nativeBytes = 16 * 1024 ** 2 + Math.ceil(channelCount / 2) * (fft * 256 + 65536);
	if (nativeBytes > 64 * 1024 ** 2) throw new RangeError('Auto-Tune exceeds its native memory limit. Reduce channels or sample rate.');
	return { analysisFrames, analysisDelayFrames, nativeBlockFrames, deliveryFrames, latencyFrames, queueFrames,
		stateBytes: nativeBytes + channelCount * (latencyFrames + analysisFrames + queueFrames + 1024) * 4 };
}
