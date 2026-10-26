/* SPDX-License-Identifier: AGPL-3.0-only */

import { amplitudeToDb, calculateAudioSpectrum } from './audio-spectrum.ts';
import { prepareBoundedWaveformWindow } from './design-system-adapters/waveform.ts';
import type { WaveformRendering } from './design-system-adapters/types.ts';
import { decodeManagedSdrOutputPixelV1, encodeManagedSdrLinearPixelV1 } from './video-color-management-v27.ts';
import {
	SOUND_VISUALIZER_SPECTRUM_SIZE,
	soundVisualizerSpectrumWindowStarts,
} from './sound-visualizer-spectrum-windows.ts';

export type SoundVisualizerMode = 'waveform' | 'spectrum';

export interface SoundVisualizerRgbaRequest {
	readonly mode: SoundVisualizerMode;
	/** Waveform PCM or packed, evenly spaced 1,024-sample spectrum snapshots. */
	readonly channels: readonly Float32Array[] | null;
	readonly sampleRate: number;
	/** Project timeline sample at the left edge; may precede timeline zero. */
	readonly windowStartFrame: number;
	/** Output video frame ordinal; the scan marker changes on every frame. */
	readonly timelineFrame: number;
	readonly width: number;
	readonly height: number;
	readonly foregroundColor: string;
	readonly backgroundColor: string;
}

export interface SoundVisualizerRgbaFrame {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array<ArrayBuffer>;
}

type Rgba = readonly [number, number, number, number];
type PixelBlends = Map<Rgba, Map<number, Rgba>>;

const MAXIMUM_PIXELS = 33_554_432;
const MAXIMUM_PCM_FRAMES = 4_194_304;
const SPECTRUM_FLOOR_DB = -90;
const SPECTRUM_CEILING_DB = -6;

/** Render an exact video frame from a bounded, time-varying audio view. */
export function renderSoundVisualizerRgba(request: SoundVisualizerRgbaRequest): SoundVisualizerRgbaFrame {
	if (request.mode !== 'waveform' && request.mode !== 'spectrum') {
		throw new RangeError('Unsupported sound visualizer mode.');
	}
	const width = dimension(request.width, 'width');
	const height = dimension(request.height, 'height');
	if (width * height > MAXIMUM_PIXELS) throw new RangeError('Sound visualizer frame pixel count exceeds its limit.');
	if (!Number.isFinite(request.sampleRate) || request.sampleRate <= 0) {
		throw new RangeError('Sound visualizer sampleRate must be positive.');
	}
	const windowStartFrame = safeFrame(request.windowStartFrame, 'windowStartFrame');
	nonNegativeFrame(request.timelineFrame, 'timelineFrame');
	const foreground = color(request.foregroundColor, 'foregroundColor');
	const background = color(request.backgroundColor, 'backgroundColor');
	const channels = validateChannels(request.channels);
	if (channels !== null && !Number.isSafeInteger(windowStartFrame + channels[0]!.length)) {
		throw new RangeError('Sound visualizer PCM window end frame overflows.');
	}
	const pixels = new Uint8Array(width * height * 4);
	fillBackground(pixels, background);
	const blends: PixelBlends = new Map();
	if (channels !== null) {
		if (request.mode === 'waveform') drawWaveform(pixels, width, height, channels, foreground, blends);
		else drawSpectrum(pixels, width, height, channels, request.sampleRate, foreground, blends);
	}
	drawMovingMarker(pixels, width, height, request.timelineFrame);
	return Object.freeze({ width, height, pixels });
}

function drawWaveform(
	pixels: Uint8Array<ArrayBuffer>, width: number, height: number,
	channels: readonly Float32Array[], foreground: Rgba, blends: PixelBlends,
): void {
	const sampleCount = channels[0]!.length;
	const rendering = prepareBoundedWaveformWindow(channels, {
		sourceStartFrame: 0, durationFrames: sampleCount,
	}, {
		pixelWidth: width,
		maxSamples: Math.max(1, Math.min(4_096, width * 2)),
		reuseSummaryForCompatibility: true,
	}).rendering;
	const centerY = Math.floor(height / 2);
	const maximumAmplitude = Math.max(0, Math.floor((height - 2) / 2));
	const centerColor: Rgba = [foreground[0], foreground[1], foreground[2], Math.round(foreground[3] / 4)];
	for (let x = 0; x < width; x += 1) paintPixel(pixels, width, x, centerY, centerColor, blends);
	for (let x = 0; x < width; x += 1) {
		const extrema = rendering?.mode === 'summary'
			? summaryExtrema(rendering, x, width)
			: interpolatedExtrema(channels, x, width);
		const top = centerY - Math.round(extrema.maximum * maximumAmplitude);
		const bottom = centerY - Math.round(extrema.minimum * maximumAmplitude);
		paintVertical(pixels, width, height, x, top, bottom, foreground, blends);
	}
}

function summaryExtrema(rendering: WaveformRendering, x: number, width: number) {
	const columnCount = Math.max(1, Math.ceil(rendering.pixelWidth));
	const column = Math.min(columnCount - 1, Math.floor(x * columnCount / width));
	let minimum = Number.POSITIVE_INFINITY;
	let maximum = Number.NEGATIVE_INFINITY;
	for (const channel of rendering.channels) {
		if (!('minimum' in channel)) continue;
		minimum = Math.min(minimum, finiteSample(channel.minimum[column]));
		maximum = Math.max(maximum, finiteSample(channel.maximum[column]));
	}
	return {
		minimum: Number.isFinite(minimum) ? minimum : 0,
		maximum: Number.isFinite(maximum) ? maximum : 0,
	};
}

function interpolatedExtrema(channels: readonly Float32Array[], x: number, width: number) {
	const sampleCount = channels[0]!.length;
	const position = (x + 0.5) * sampleCount / width - 0.5;
	const first = Math.max(0, Math.min(sampleCount - 1, Math.floor(position)));
	const second = Math.min(sampleCount - 1, first + 1);
	const fraction = Math.max(0, Math.min(1, position - first));
	let minimum = Number.POSITIVE_INFINITY;
	let maximum = Number.NEGATIVE_INFINITY;
	for (const channel of channels) {
		const value = finiteSample(channel[first]) * (1 - fraction) + finiteSample(channel[second]) * fraction;
		minimum = Math.min(minimum, value);
		maximum = Math.max(maximum, value);
	}
	return { minimum, maximum };
}

function drawSpectrum(
	pixels: Uint8Array<ArrayBuffer>, width: number, height: number,
	channels: readonly Float32Array[], sampleRate: number, foreground: Rgba, blends: PixelBlends,
): void {
	const sampleCount = channels[0]!.length;
	const starts = soundVisualizerSpectrumWindowStarts(sampleCount);
	const powers = new Float64Array(SOUND_VISUALIZER_SPECTRUM_SIZE / 2 + 1);
	for (const offsetFrame of starts) {
		const spectrum = calculateAudioSpectrum(channels, sampleRate, {
			size: SOUND_VISUALIZER_SPECTRUM_SIZE, offsetFrame,
		});
		for (let index = 0; index < powers.length; index += 1) {
			powers[index] += spectrum.bins[index]!.amplitude ** 2;
		}
	}
	const lastBin = powers.length - 1;
	const tops = new Int32Array(width).fill(height);
	const bottoms = new Int32Array(width).fill(-1);
	let previousY = height - 1;
	for (let x = 0; x < width; x += 1) {
		const normalizedX = x / Math.max(1, width - 1);
		const binIndex = Math.max(1, Math.min(lastBin, Math.round(lastBin ** normalizedX)));
		// A logarithmic pixel can cover several high-frequency bins. Keep its
		// strongest bin instead of losing peaks between the rounded centers.
		const firstBin = width === 1 ? 1 : Math.max(1,
			Math.ceil(lastBin ** ((x - 0.5) / (width - 1))));
		const finalBin = width === 1 ? lastBin : Math.min(lastBin,
			Math.floor(lastBin ** ((x + 0.5) / (width - 1))));
		let power = powers[binIndex]!;
		for (let bin = firstBin; bin <= finalBin; bin += 1) power = Math.max(power, powers[bin]!);
		const db = amplitudeToDb(Math.sqrt(power / starts.length));
		const intensity = Math.max(0, Math.min(1,
			(db - SPECTRUM_FLOOR_DB) / (SPECTRUM_CEILING_DB - SPECTRUM_FLOOR_DB),
		));
		const y = Math.round((height - 1) * (1 - intensity));
		if (x > 0) traceLine(tops, bottoms, x - 1, previousY, x, y);
		else { tops[x] = y; bottoms[x] = y; }
		previousY = y;
	}
	for (let x = 0; x < width; x++) {
		paintVertical(pixels, width, height, x, tops[x]!, bottoms[x]!, foreground, blends);
	}
}

/** Adjacent segments share pixel coverage, so blend their contiguous column union once. */
function traceLine(
	tops: Int32Array, bottoms: Int32Array, x0: number, y0: number, x1: number, y1: number,
): void {
	const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
	for (let step = 0; step <= steps; step += 1) {
		const fraction = steps === 0 ? 0 : step / steps;
		const x = Math.round(x0 + (x1 - x0) * fraction);
		const y = Math.round(y0 + (y1 - y0) * fraction);
		tops[x] = Math.min(tops[x]!, y);
		bottoms[x] = Math.max(bottoms[x]!, y);
	}
}

function paintVertical(
	pixels: Uint8Array<ArrayBuffer>, width: number, height: number,
	x: number, y0: number, y1: number, rgba: Rgba, blends: PixelBlends,
): void {
	const first = Math.max(0, Math.min(y0, y1));
	const last = Math.min(height - 1, Math.max(y0, y1));
	for (let y = first; y <= last; y += 1) paintPixel(pixels, width, x, y, rgba, blends);
}

function paintPixel(pixels: Uint8Array<ArrayBuffer>, width: number, x: number, y: number, rgba: Rgba, blends: PixelBlends): void {
	const offset = (y * width + x) * 4;
	if (rgba[3] === 0) return;
	if (rgba[3] === 255 || pixels[offset + 3] === 0) { pixels.set(rgba, offset); return; }
	// A frame has one foreground, one centerline color, and their fixed
	// background blends. Cache those few colors instead of running transfer
	// functions for every waveform pixel.
	let colors = blends.get(rgba);
	if (!colors) { colors = new Map(); blends.set(rgba, colors); }
	const key = ((pixels[offset]! << 24) | (pixels[offset + 1]! << 16)
		| (pixels[offset + 2]! << 8) | pixels[offset + 3]!) >>> 0;
	let mixed = colors.get(key);
	if (!mixed) {
		mixed = sourceOver(rgba, [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!, pixels[offset + 3]!]);
		colors.set(key, mixed);
	}
	pixels.set(mixed, offset);
}

/** Authoring colors are sRGB; all selected finishing composition is linear Rec.709/D65. */
function sourceOver(source: Rgba, backdrop: Rgba): Rgba {
	const upper = decodeManagedSdrOutputPixelV1(source.map(value => value / 255), 'srgb');
	const lower = decodeManagedSdrOutputPixelV1(backdrop.map(value => value / 255), 'srgb');
	const lowerAlpha = lower[3] * (1 - upper[3]);
	const alpha = upper[3] + lowerAlpha;
	const channel = (index: 0 | 1 | 2): number => (upper[index] * upper[3] + lower[index] * lowerAlpha) / alpha;
	const output = encodeManagedSdrLinearPixelV1([channel(0), channel(1), channel(2), alpha], 'srgb');
	return [Math.round(output[0] * 255), Math.round(output[1] * 255), Math.round(output[2] * 255), Math.round(output[3] * 255)];
}

function drawMovingMarker(
	pixels: Uint8Array<ArrayBuffer>, width: number, height: number, timelineFrame: number,
): void {
	const x = timelineFrame % width;
	for (let y = 0; y < height; y += 1) {
		const offset = (y * width + x) * 4;
		const luminance = (pixels[offset]! * 299 + pixels[offset + 1]! * 587
			+ pixels[offset + 2]! * 114) / 1_000;
		const value = (luminance < 128) !== (width === 1 && timelineFrame % 2 === 1) ? 255 : 0;
		pixels[offset] = value;
		pixels[offset + 1] = value;
		pixels[offset + 2] = value;
		pixels[offset + 3] = 255;
	}
}

function fillBackground(pixels: Uint8Array<ArrayBuffer>, background: Rgba): void {
	if (background.every((value) => value === 0)) return;
	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels[offset] = background[0];
		pixels[offset + 1] = background[1];
		pixels[offset + 2] = background[2];
		pixels[offset + 3] = background[3];
	}
}

function validateChannels(value: readonly Float32Array[] | null): readonly Float32Array[] | null {
	if (value === null || value.length === 0) return null;
	if (value.some((channel) => !(channel instanceof Float32Array))) {
		throw new TypeError('Sound visualizer channels must be Float32Array PCM.');
	}
	const sampleCount = value[0]!.length;
	if (value.some((channel) => channel.length !== sampleCount)) {
		throw new RangeError('Sound visualizer channels must have equal lengths.');
	}
	if (sampleCount > MAXIMUM_PCM_FRAMES) throw new RangeError('Sound visualizer PCM window is too long.');
	return sampleCount === 0 ? null : value;
}

function color(value: string, name: string): Rgba {
	if (typeof value !== 'string' || !/^#[a-f0-9]{8}$/u.test(value)) {
		throw new TypeError(`Sound visualizer ${name} must be canonical #rrggbbaa.`);
	}
	return [
		Number.parseInt(value.slice(1, 3), 16),
		Number.parseInt(value.slice(3, 5), 16),
		Number.parseInt(value.slice(5, 7), 16),
		Number.parseInt(value.slice(7, 9), 16),
	];
}

function dimension(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > 65_536) {
		throw new RangeError(`Sound visualizer ${name} is invalid.`);
	}
	return value;
}

function nonNegativeFrame(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Sound visualizer ${name} is invalid.`);
	}
	return value;
}

function safeFrame(value: number, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`Sound visualizer ${name} is invalid.`);
	return value;
}

function finiteSample(value: number | undefined): number {
	return Number.isFinite(value) ? Number(value) : 0;
}
