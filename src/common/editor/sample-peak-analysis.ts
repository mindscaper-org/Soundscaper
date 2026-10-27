/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded streaming sample-peak work has no programme loudness or intersample-peak state. */
export function createStreamingSamplePeakAnalyzer(options: Readonly<{ sampleRate?: unknown; channelCount?: unknown }> = {}) {
	const sampleRate = Number(options.sampleRate), channelCount = Number(options.channelCount ?? 2);
	if (!Number.isInteger(sampleRate) || sampleRate < 8_000) throw new RangeError('A valid analysis sample rate is required.');
	if (!Number.isSafeInteger(channelCount) || channelCount < 1) throw new RangeError('A positive analysis channel count is required.');
	let peakAmplitude = 0, result: Readonly<{ peakAmplitude: number; integratedLufs: null }> | null = null;
	return Object.freeze({
		push(channels: readonly Float32Array[]): void {
			if (result) throw new Error('Cannot add PCM after analysis has finished.');
			if (!Array.isArray(channels) || channels.length !== channelCount) throw new RangeError(`Expected ${channelCount} PCM channels.`);
			const frames = channels[0]?.length;
			if (!Number.isInteger(frames)) throw new TypeError('PCM channels must be typed arrays.');
			if (channels.some(channel => !ArrayBuffer.isView(channel) || !('length' in channel) || channel.length !== frames)) throw new RangeError('PCM channels must be equally sized typed arrays.');
			for (const channel of channels) for (let frame = 0; frame < frames!; frame++) {
				const sample = Number(channel[frame]);
				if (!Number.isFinite(sample)) throw new RangeError('PCM samples must be finite.');
				peakAmplitude = Math.max(peakAmplitude, Math.abs(sample));
			}
		},
		finish() { return result ??= Object.freeze({ peakAmplitude, integratedLufs: null }); },
	});
}

export function analyzeSamplePeakChannels(channels: readonly Float32Array[], sampleRate: number) {
	const analyzer = createStreamingSamplePeakAnalyzer({ sampleRate, channelCount: channels.length });
	analyzer.push(channels);
	return analyzer.finish();
}
