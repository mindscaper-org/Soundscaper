/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS,
	MAXIMUM_WAVEFORM_PEAK_WINDOW_CHANNEL_BUCKETS,
} from '../../../waveform-peak-contract.ts';
import { throwIfAborted } from '../../shared/app-helpers.ts';
import type {
	WaveformPcmProvider,
	WaveformPcmRange,
	WaveformPeakWindow,
	WaveformPeakWindowOptions,
} from '../waveform-analysis.ts';

/** Stream one viewport-sized peak level without retaining its complete PCM range. */
export async function readWaveformPeakWindow(
	provider: WaveformPcmProvider,
	range: WaveformPcmRange,
	options: WaveformPeakWindowOptions,
): Promise<WaveformPeakWindow> {
	validateRequest(provider, range, options);
	throwIfAborted(options.signal);
	const frameCount = range.endFrame - range.startFrame;
	const blockSize = Math.min(
		Math.floor(frameCount / options.pixelWidth),
		options.maximumBlockSize ?? Number.MAX_SAFE_INTEGER,
	);
	if (blockSize < 1) throw new RangeError('This waveform scale requires individual PCM samples.');
	const bucketCount = Math.ceil(frameCount / blockSize);
	if (!Number.isSafeInteger(bucketCount)) throw new RangeError('The waveform peak window is too large.');
	if (bucketCount > MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS) {
		throw new RangeError('The waveform peak window exceeds its bucket budget.');
	}
	const retainedChannelCount = Math.min(options.maximumChannels ?? provider.channelCount, provider.channelCount);
	if (bucketCount * retainedChannelCount > MAXIMUM_WAVEFORM_PEAK_WINDOW_CHANNEL_BUCKETS) {
		throw new RangeError('The waveform peak window exceeds its memory budget.');
	}
	const summaries = Array.from({ length: retainedChannelCount }, () => ({
		minimums: new Float32Array(bucketCount), maximums: new Float32Array(bucketCount), rms: new Float32Array(bucketCount),
	}));
	const accumulators = summaries.map(() => ({ minimum: Infinity, maximum: -Infinity, squares: 0 }));
	const { chunkFrames, channelCount } = provider;
	const { startFrame, endFrame } = range;
	const { signal } = options;
	const readOptions = signal ? { signal } : null;
	const firstChunk = Math.floor(startFrame / chunkFrames);
	const lastChunk = Math.ceil(endFrame / chunkFrames) - 1;
	let framesRead = 0;
	let bucket = 0, fill = 0;
	for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
		throwIfAborted(signal);
		const value = await (readOptions ? provider.readStorageChunk(chunkIndex, readOptions) : provider.readStorageChunk(chunkIndex));
		throwIfAborted(signal);
		const channels = 'channels' in value ? value.channels : value;
		const chunkLength = channels[0]?.length;
		if (channels.length !== channelCount || channels.some(channel => !(channel instanceof Float32Array) || channel.length !== chunkLength)) {
			throw new Error('The waveform peak window received invalid PCM channels.');
		}
		const chunkStart = chunkIndex * chunkFrames;
		const from = Math.max(startFrame, chunkStart) - chunkStart;
		const to = Math.min(endFrame, chunkStart + (chunkLength || 0)) - chunkStart;
		for (let offset = from; offset < to;) {
			const count = Math.min(blockSize - fill, to - offset);
			const end = offset + count;
			framesRead += count;
			fill += count;
			const complete = fill === blockSize || framesRead === frameCount;
			for (let channel = 0; channel < retainedChannelCount; channel += 1) {
				const samples = channels[channel]!, accumulator = accumulators[channel]!;
				let { minimum, maximum, squares } = accumulator;
				for (let frame = offset; frame < end; frame += 1) {
					const sample = samples[frame]!;
					minimum = Math.min(minimum, sample);
					maximum = Math.max(maximum, sample);
					squares += sample * sample;
				}
				if (complete) {
					const summary = summaries[channel]!;
					summary.minimums[bucket] = minimum;
					summary.maximums[bucket] = maximum;
					summary.rms[bucket] = Math.sqrt(squares / fill);
					accumulator.minimum = Infinity;
					accumulator.maximum = -Infinity;
					accumulator.squares = 0;
				} else {
					accumulator.minimum = minimum;
					accumulator.maximum = maximum;
					accumulator.squares = squares;
				}
			}
			if (complete) { bucket += 1; fill = 0; }
			offset = end;
		}
	}
	if (framesRead !== frameCount) throw new Error('The waveform peak window is incomplete.');
	return {
		...range,
		blockSize,
		pixelsPerSample: options.pixelWidth / frameCount,
		channels: summaries,
	};
}

function validateRequest(
	provider: WaveformPcmProvider,
	range: WaveformPcmRange,
	options: WaveformPeakWindowOptions,
): void {
	if (!Number.isSafeInteger(provider.channelCount) || provider.channelCount < 1 || provider.channelCount > 1_024
		|| !Number.isSafeInteger(provider.chunkFrames) || provider.chunkFrames < 1) {
		throw new RangeError('A waveform peak window requires valid provider geometry.');
	}
	if (!Number.isSafeInteger(range.startFrame) || range.startFrame < 0
		|| !Number.isSafeInteger(range.endFrame) || range.endFrame <= range.startFrame) {
		throw new RangeError('A waveform peak window requires a positive safe frame range.');
	}
	if (!Number.isFinite(options.pixelWidth) || options.pixelWidth <= 0) {
		throw new RangeError('A waveform peak window requires a positive finite pixel width.');
	}
	if (options.maximumBlockSize !== undefined
		&& (!Number.isSafeInteger(options.maximumBlockSize) || options.maximumBlockSize < 1)) {
		throw new RangeError('A waveform peak window requires a positive safe maximum block size.');
	}
	if (options.maximumChannels !== undefined
		&& (!Number.isSafeInteger(options.maximumChannels) || options.maximumChannels < 1)) {
		throw new RangeError('A waveform peak window requires a positive safe channel limit.');
	}
}
