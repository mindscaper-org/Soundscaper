/* SPDX-License-Identifier: GPL-3.0-only */
// Geometry adaptation of audacity-waveform-renderer.js. Audacity attribution
// and exact upstream source paths are recorded in THIRD_PARTY_LICENSES.md.
import { scaleWaveformAmplitude } from '../../../waveform-amplitude-scale.ts';
import type { WaveformGpuGeometryOptions, WaveformGpuPlan } from './waveform-gpu-contract.ts';

/** Seven instance attributes per column: x extent, peak extent, RMS extent and selection x. */
export function prepareWaveformGpuGeometry(plan: WaveformGpuPlan, options: WaveformGpuGeometryOptions): Float32Array {
	const channel = plan.channels[options.channel];
	const sourceCount = channel ? Math.min(channel.minimum.length, channel.maximum.length) : 0;
	if (!sourceCount) return new Float32Array();
	const columns = Math.ceil(options.width);
	const data = new Float32Array(columns * 7);
	const rmsValues = options.showRms ? channel.rms : null;
	const scale = options.amplitudeScale ?? 'linear';
	const topLimit = options.channelTop * options.pixelRatioY;
	const bottomLimit = (options.channelTop + options.channelHeight) * options.pixelRatioY;
	const span = (minimum: number, maximum: number) => {
		const top = Math.round(options.centerY - maximum * options.maxAmplitude);
		const bottom = Math.max(top + 1, Math.round(options.centerY - minimum * options.maxAmplitude));
		return [Math.max(topLimit, Math.min(bottomLimit, top * options.pixelRatioY)),
			Math.max(topLimit, Math.min(bottomLimit, bottom * options.pixelRatioY))];
	};
	for (let x = 0; x < columns; x++) {
		const first = Math.min(sourceCount - 1, Math.floor(x * sourceCount / columns));
		const last = Math.min(sourceCount, Math.max(first + 1, Math.ceil((x + 1) * sourceCount / columns)));
		let minimum = Infinity; let maximum = -Infinity; let squareSum = 0;
		for (let index = first; index < last; index++) {
			minimum = Math.min(minimum, finiteSample(channel.minimum[index]));
			maximum = Math.max(maximum, finiteSample(channel.maximum[index]));
			if (rmsValues) squareSum += finiteSample(rmsValues[index]) ** 2;
		}
		const gainValue = options.envelopeGain?.(x, columns) ?? 1;
		const gain = Number.isFinite(gainValue) ? Math.max(0, gainValue) : 1;
		minimum = scaleWaveformAmplitude(minimum * gain, scale);
		maximum = scaleWaveformAmplitude(maximum * gain, scale);
		if (minimum > maximum) [minimum, maximum] = [maximum, minimum];
		if (options.halfWave) { minimum = Math.max(0, minimum); maximum = Math.max(0, maximum); }
		const offset = x * 7;
		data[offset] = Math.round(x * options.pixelRatioX);
		data[offset + 1] = Math.round((x + 1) * options.pixelRatioX);
		[data[offset + 2], data[offset + 3]] = span(minimum, maximum);
		if (rmsValues) {
			const rms = scaleWaveformAmplitude(Math.sqrt(squareSum / (last - first)) * gain, scale);
			const lower = options.halfWave ? minimum : Math.max(minimum, -rms);
			const upper = Math.min(maximum, rms);
			if (lower <= upper) [data[offset + 4], data[offset + 5]] = span(lower, upper);
		}
		data[offset + 6] = x;
	}
	return data;
}

function finiteSample(value: unknown): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : 0;
}
