/* SPDX-License-Identifier: GPL-3.0-only */

/** Match the recorded FFT grid without changing its learned spectral powers. */
export function noiseReductionProfileRate(profile: unknown, fallback: number): number {
	const rate: unknown = profile && typeof profile === 'object' && 'sampleRate' in profile ? profile.sampleRate : null;
	return typeof rate === 'number' && Number.isFinite(rate) && rate >= 8000 && rate <= 384000 ? rate : fallback;
}

export const NOISE_REDUCTION_RESAMPLE_RADIUS = 24;

export function noiseReductionClockGeometry(deviceRate: number, profileRate: number, profileLatency: number) {
	if (deviceRate === profileRate) return { reserveFrames: 0, latencyFrames: profileLatency, outputPhase: 0 };
	const ratio = deviceRate / profileRate;
	// Both sinc passes need future samples. A fixed reserve covers that lookahead
	// independently of worklet quantum or caller block boundaries.
	const reserveFrames = Math.ceil(NOISE_REDUCTION_RESAMPLE_RADIUS + (NOISE_REDUCTION_RESAMPLE_RADIUS + 1) * ratio) + 2;
	const convertedLatency = Math.floor(profileLatency * ratio);
	return {
		reserveFrames,
		latencyFrames: reserveFrames + convertedLatency,
		// Retain the fractional phase when converting back, making the complete
		// processing delay an integer number of device samples for rack PDC.
		outputPhase: Math.max(0, profileLatency - convertedLatency / ratio),
	};
}

export function noiseReductionClockTailFrames(deviceRate: number, profileRate: number, profileTail: number): number {
	return deviceRate === profileRate || profileTail === 0 ? profileTail : Math.ceil(profileTail * deviceRate / profileRate)
		+ noiseReductionClockGeometry(deviceRate, profileRate, 0).reserveFrames;
}
