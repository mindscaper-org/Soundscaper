/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MicrophoneBleedOptions {
	readonly maximumReductionDb?: number;
	readonly minimumSimilarity?: number;
	readonly fadeMs?: number;
}
export interface MicrophoneBleedPoint { readonly frame: number; readonly value: number }
export interface MicrophoneBleedBlock {
	readonly tracks: readonly (readonly Float32Array[])[];
	readonly sampleRate: number;
	readonly offsetFrames: number;
	readonly frameCount: number;
	readonly options: MicrophoneBleedOptions;
}
export const MICROPHONE_BLEED_MAXIMUM_TRACKS = 8;
export const MICROPHONE_BLEED_MAXIMUM_POINTS = 100_000;

export function normalizeMicrophoneBleedOptions(options: MicrophoneBleedOptions = {}): Required<MicrophoneBleedOptions> {
	const bounded = (value: number | undefined, fallback: number, minimum: number, maximum: number): number => {
		const result = value ?? fallback;
		if (!Number.isFinite(result) || result < minimum || result > maximum) throw new RangeError('Invalid microphone-bleed settings.');
		return result;
	};
	return { maximumReductionDb: bounded(options.maximumReductionDb, 12, 0, 36),
		minimumSimilarity: bounded(options.minimumSimilarity, .9, .5, 1), fadeMs: bounded(options.fadeMs, 80, 20, 500) };
}

export function microphoneBleedHopFrames(sampleRate: number): number {
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new RangeError('Unsupported microphone-bleed sample rate.');
	return Math.round(sampleRate * .02);
}

/** Joint, level-qualified similarity detection. A quieter independent signal stays open. */
export function analyzeMicrophoneBleedBlock(request: MicrophoneBleedBlock): boolean[][] {
	const { tracks, sampleRate, offsetFrames, frameCount } = request;
	const settings = normalizeMicrophoneBleedOptions(request.options), hop = microphoneBleedHopFrames(sampleRate);
	if (tracks.length < 2 || tracks.length > MICROPHONE_BLEED_MAXIMUM_TRACKS
		|| !Number.isSafeInteger(offsetFrames) || offsetFrames < 0 || !Number.isSafeInteger(frameCount) || frameCount <= 0
		|| frameCount > hop * 250) throw new RangeError('Microphone-bleed analysis requires two to eight microphones and bounded PCM.');
	const length = tracks[0]?.[0]?.length ?? 0;
	if (length > hop * 254 || offsetFrames + frameCount > length) throw new RangeError('Invalid microphone-bleed PCM range.');
	for (const channels of tracks) {
		if (channels.length < 1 || channels.length > 2 || channels.some(channel => !(channel instanceof Float32Array) || channel.length !== length)) {
			throw new RangeError('Microphone-bleed PCM must contain aligned mono or stereo tracks.');
		}
	}
	// Box-average before decimation, retaining speech-band evidence without full-rate pairwise FFTs.
	const stride = Math.max(1, Math.floor(sampleRate / 4000));
	const decimated = tracks.map(channels => channels.map(channel => {
		const output = new Float32Array(Math.ceil(length / stride));
		for (let index = 0; index < output.length; index++) {
			let sum = 0, count = 0;
			for (let frame = index * stride; frame < Math.min(length, (index + 1) * stride); frame++) {
				const value = channel[frame]!;
				if (!Number.isFinite(value)) throw new RangeError('Microphone-bleed PCM must be finite.');
				sum += value; count++;
			}
			output[index] = sum / count;
		}
		return output;
	}));
	const result = tracks.map(() => [] as boolean[]), lagLimit = Math.ceil(sampleRate * .01 / stride);
	for (let frame = 0; frame < frameCount; frame += hop) {
		const center = Math.floor((offsetFrames + frame + hop / 2) / stride);
		const start = Math.max(lagLimit, center - Math.floor(hop / stride));
		const end = Math.min(decimated[0]![0]!.length - lagLimit, center + Math.floor(hop / stride));
		const windows = decimated.map(channels => channels.map(channel => centered(channel, start, end))
			.sort((a, b) => b.energy - a.energy)[0]!);
		for (let target = 0; target < tracks.length; target++) {
			const local = windows[target]!;
			let duck = false;
			if (end - start >= 32 && local.energy / (end - start) > 1e-8) {
				for (let other = 0; other < tracks.length && !duck; other++) {
					const reference = windows[other]!;
					// Six dB of dominance is required in addition to waveform agreement.
					if (other === target || reference.energy < local.energy * 4) continue;
					for (let lag = -lagLimit; lag <= lagLimit && !duck; lag++) {
						const shifted = centered(reference.channel, start + lag, end + lag);
						let product = 0;
						for (let index = 0; index < local.values.length; index++) product += local.values[index]! * shifted.values[index]!;
						const similarity = Math.abs(product) / Math.sqrt(Math.max(1e-30, local.energy * shifted.energy));
						duck = similarity >= settings.minimumSimilarity;
					}
				}
			}
			result[target]!.push(duck);
		}
	}
	return result;
}

function centered(channel: Float32Array, start: number, end: number) {
	const values = channel.slice(start, Math.max(start, end));
	let mean = 0, energy = 0;
	for (const value of values) mean += value;
	mean /= Math.max(1, values.length);
	for (let index = 0; index < values.length; index++) { values[index] = values[index]! - mean; energy += values[index]! ** 2; }
	return { channel, values, energy };
}

/** Convert complete decisions into sparse, editable linear gain envelopes. */
export function buildMicrophoneBleedCurves(decisions: readonly (readonly boolean[])[], sampleRate: number,
	frameCount: number, options: MicrophoneBleedOptions): MicrophoneBleedPoint[][] {
	const settings = normalizeMicrophoneBleedOptions(options), hop = microphoneBleedHopFrames(sampleRate);
	const hold = Math.round(sampleRate * .12), fade = Math.round(sampleRate * settings.fadeMs / 1000);
	const anticipation = Math.round(sampleRate * .04), opening = Math.round(sampleRate * .02);
	return decisions.map(track => {
		const points: MicrophoneBleedPoint[] = [{ frame: 0, value: 1 }];
		const floor = 10 ** (-settings.maximumReductionDb / 20);
		for (let index = 0; index < track.length;) {
			if (!track[index] || floor === 1) { index++; continue; }
			const start = index * hop;
			while (track[index]) index++;
			const end = Math.min(frameCount, index * hop);
			if (end - start <= hold + fade + anticipation + opening) continue;
			points.push({ frame: start + hold, value: 1 }, { frame: start + hold + fade, value: floor },
				{ frame: end - anticipation - opening, value: floor }, { frame: end - anticipation, value: 1 });
			if (points.length > MICROPHONE_BLEED_MAXIMUM_POINTS - 1) throw new RangeError('Too many microphone-bleed transitions. Select a shorter range.');
		}
		points.push({ frame: frameCount, value: 1 });
		return points;
	});
}
