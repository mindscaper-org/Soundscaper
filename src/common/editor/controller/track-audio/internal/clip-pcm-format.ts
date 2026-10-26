/* SPDX-License-Identifier: AGPL-3.0-only */

export type ClipPcmFormat = 'int16' | 'int24' | 'float32';
export type StoredPcmFormat = ClipPcmFormat | 'int32' | 'float64';

export function clipPcmFormat(value: unknown): ClipPcmFormat {
	if (value === 'int16' || value === 'int24' || value === 'float32') return value;
	throw new RangeError('Clip format must be 16-bit PCM, 24-bit PCM or 32-bit float.');
}

export function storedPcmFormat(value: unknown): StoredPcmFormat {
	return value === 'int16' || value === 'int24' || value === 'int32' || value === 'float64' ? value : 'float32';
}

export function pcmBytesPerSample(format: StoredPcmFormat): number {
	return format === 'int16' ? 2 : format === 'int24' ? 3 : format === 'float64' ? 8 : 4;
}

/** The store remains float32; integer precision is applied to the samples themselves. */
export function convertPcmPrecision(channels: Float32Array[], format: ClipPcmFormat): Float32Array[] {
	if (format === 'float32') return channels;
	const scale = format === 'int16' ? 32768 : 8388608;
	return channels.map(channel => Float32Array.from(channel, sample => integerSample(sample, scale) / scale));
}

/** Decode the same little-endian, interleaved PCM bytes under a different sample width. */
export function reinterpretPcmChannels(channels: Float32Array[], inputFormat: string | undefined,
	outputFormat: StoredPcmFormat): Float32Array[] {
	const input = storedPcmFormat(inputFormat);
	if (input === outputFormat) return channels;
	const channelCount = channels.length;
	const frames = channels[0]?.length ?? 0;
	if (!channelCount || !frames || channels.some(channel => channel.length !== frames)) throw new RangeError('PCM channels must have equal non-empty frame counts.');
	const inputBytes = pcmBytesPerSample(input);
	const outputBytes = pcmBytesPerSample(outputFormat);
	const length = frames * channelCount * inputBytes;
	if (length % (channelCount * outputBytes)) throw new RangeError('Reinterpret requires complete PCM frames at the selected bit depth.');
	const data = new DataView(new ArrayBuffer(length));
	for (let frame = 0; frame < frames; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			write(data, (frame * channelCount + channel) * inputBytes, channels[channel]![frame]!, input);
		}
	}
	const outputFrames = length / (channelCount * outputBytes);
	const output = Array.from({ length: channelCount }, () => new Float32Array(outputFrames));
	for (let frame = 0; frame < outputFrames; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			const sample = read(data, (frame * channelCount + channel) * outputBytes, outputFormat);
			if (!Number.isFinite(Math.fround(sample))) throw new RangeError('Reinterpret produced non-finite float samples; choose another bit depth.');
			output[channel]![frame] = sample;
		}
	}
	return output;
}

function integerSample(value: number, scale: number): number {
	if (!Number.isFinite(value)) throw new RangeError('PCM conversion requires finite samples.');
	return Math.min(scale - 1, Math.max(-scale, Math.round(value * scale)));
}

function write(data: DataView, offset: number, sample: number, format: StoredPcmFormat): void {
	if (format === 'float32') data.setFloat32(offset, sample, true);
	else if (format === 'float64') data.setFloat64(offset, sample, true);
	else if (format === 'int16') data.setInt16(offset, integerSample(sample, 32768), true);
	else if (format === 'int32') data.setInt32(offset, integerSample(sample, 2147483648), true);
	else {
		const value = integerSample(sample, 8388608);
		data.setUint8(offset, value & 255);
		data.setUint8(offset + 1, (value >> 8) & 255);
		data.setUint8(offset + 2, (value >> 16) & 255);
	}
}

function read(data: DataView, offset: number, format: StoredPcmFormat): number {
	if (format === 'float32') return data.getFloat32(offset, true);
	if (format === 'float64') return data.getFloat64(offset, true);
	if (format === 'int32') return data.getInt32(offset, true) / 2147483648;
	if (format === 'int16') return data.getInt16(offset, true) / 32768;
	const unsigned = data.getUint8(offset) | (data.getUint8(offset + 1) << 8) | (data.getUint8(offset + 2) << 16);
	return ((unsigned << 8) >> 8) / 8388608;
}
