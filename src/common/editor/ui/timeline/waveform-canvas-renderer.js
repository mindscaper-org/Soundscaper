/* SPDX-License-Identifier: AGPL-3.0-only */

import { boundedCanvasDimensions } from '../../design-system-adapters/canvas.ts';
import { createEnvelopeValueEvaluator } from '../../automation.js';
import { audacityWaveformChannelGeometry, drawAudacityWaveformChannel } from '../../audacity-waveform-renderer.js';
import { MAXIMUM_WAVEFORM_VERTICAL_ZOOM } from '../../waveform-display-preferences.ts';
import { isFrequencyWaveformDisplayMode } from '../../track-display-mode.ts';
import { snapshotWaveformCanvasStyle } from './canvas-paint-measurements.ts';
import { paintWaveformSelectionLayers, releaseWaveformSelectionLayers } from './waveform-selection-layers.ts';
import { audioEditorStereoChannelGeometry } from './stereo-channel-height-runtime.ts';
import { drawAudacityClipSpectrogram, releaseSpectrogramCanvas } from './spectrogram-canvas-renderer.js';

const envelopeGains = new WeakMap();

function waveformEnvelopeGain(rendering, width) {
	if (!rendering.envelope?.length) return undefined;
	const cached = envelopeGains.get(rendering);
	if (cached?.width === width) return cached.gain;
	const evaluate = createEnvelopeValueEvaluator(rendering.envelope, rendering.durationFrames);
	const gain = (x) => evaluate(rendering.startFrame + x / width * rendering.frameCount);
	envelopeGains.set(rendering, { width, gain });
	return gain;
}

export function drawAudacityClipCanvas(canvas, clip, options) {
	const rendering = clip.audacityWaveform;
	const context = canvas.getContext('2d', { alpha: true });
	if (!context || !rendering.channels.length) return false;
	const bounds = options.bounds || canvas.getBoundingClientRect();
	const width = bounds.width || canvas.clientWidth || rendering.pixelWidth;
	const height = bounds.height || canvas.clientHeight;
	if (!(width > 0) || !(height > 0)) return false;
	const body = canvas.closest('.clip-body');
	const color = body?.dataset.color || options.color || 'blue';
	const style = options.style || snapshotWaveformCanvasStyle(getComputedStyle(canvas), color);
	const dimensions = boundedCanvasDimensions(Math.max(1, width), Math.max(1, height), {
		devicePixelRatio: window.devicePixelRatio || 1,
		maximumBackingHeight: 2_048,
	});
	if (canvas.width !== dimensions.backingWidth) canvas.width = dimensions.backingWidth;
	if (canvas.height !== dimensions.backingHeight) canvas.height = dimensions.backingHeight;
	const pixelRatioX = canvas.width / width;
	const pixelRatioY = canvas.height / height;
	if (!(pixelRatioX > 0) || !(pixelRatioY > 0)) return false;

	const frequencyDisplay = isFrequencyWaveformDisplayMode(options.displayMode);
	const baseWaveform = cssColor(style, frequencyDisplay ? '--frequency-sample' : `--clip-${color}-waveform`, '#172533');
	const selectedWaveform = cssColor(style, frequencyDisplay ? '--frequency-selected-sample' : `--clip-${color}-time-selection-waveform`, baseWaveform);
	const baseRms = cssColor(style, frequencyDisplay ? '--frequency-rms' : `--clip-${color}-waveform-rms`, baseWaveform);
	const selectedRms = cssColor(style, frequencyDisplay ? '--frequency-rms' : `--clip-${color}-time-selection-waveform-rms`, baseRms);
	const divider = cssColor(style, frequencyDisplay ? '--frequency-divider' : `--clip-${color}-divider`, 'rgba(0, 0, 0, 0.35)');
	const splitSeparator = cssColor(style, '--split-separator', divider);
	const selection = options.selectionPixels || clipSelectionPixels(clip, options.timeSelection, options.pixelsPerSecond, width);
	const splitY = options.displayMode === 'spectrogram'
		? height
		: options.displayMode === 'multiview' ? height / 2 : 0;
	const waveformHeight = height - splitY;
	const channelCount = Math.min(2, rendering.channels.length);
	const channelGeometry = channelCount > 1
		? audioEditorStereoChannelGeometry(waveformHeight, options.channelHeightRatio)
		: [{ top: 0, height: waveformHeight }];
	const verticalMagnification = 2 ** Math.max(0, Math.min(MAXIMUM_WAVEFORM_VERTICAL_ZOOM, Number(options.verticalZoom) || 0));
	const amplitudeScale = options.waveformRulerFormat === 'logarithmic-db' ? 'db' : 'linear';
	const envelopeGain = waveformEnvelopeGain(rendering, width);
	const waveformColor = (x) => x >= selection.start && x < selection.end
		? selectedWaveform
		: baseWaveform;
	const rmsColor = (x) => x >= selection.start && x < selection.end ? selectedRms : baseRms;
	if (body) {
		if (options.halfWave) {
			body.dataset.halfWave = 'true';
			body.dataset.waveformChannels = String(channelCount);
		} else {
			delete body.dataset.halfWave;
			delete body.dataset.waveformChannels;
		}
	}

	let frequencyPainted = false;
	let gpuPainted = false;
	const cachedSelection = !options.waveformGpuRenderer && options.cacheSelectionLayers !== false && options.displayMode === 'waveform'
		&& rendering.mode === 'summary' && paintWaveformSelectionLayers(context, {
			key: [rendering, width, height, options.showRms, options.halfWave, options.waveformRulerFormat,
				options.verticalZoom, options.channelHeightRatio, baseWaveform, selectedWaveform, baseRms, selectedRms, divider,
				cssColor(style, `--clip-${color}-time-selection-body`, 'rgba(255, 255, 255, 0.15)')],
			width, start: selection.start, end: selection.end,
			draw: (surface, selected) => drawAudacityClipCanvas(surface, clip, { ...options, color, style, cacheSelectionLayers: false,
				selectionPixels: selected ? { start: 0, end: width } : { start: -1, end: -1 }, bounds: { width, height } }),
			drawEdges: (surface, columnRanges) => drawAudacityClipCanvas(surface, clip, { ...options, color, style,
				cacheSelectionLayers: false, columnRanges, bounds: { width, height } }),
		});
	if (cachedSelection) { releaseSpectrogramCanvas(canvas); delete canvas.dataset.spectrogramRenderer; }
	if (!cachedSelection) {
		context.save();
		context.setTransform(pixelRatioX, 0, 0, pixelRatioY, 0, 0);
		context.globalAlpha = 1;
		context.globalCompositeOperation = 'source-over';
		context.clearRect(0, 0, width, height);
		if (splitY > 0) {
			drawAudacityClipSpectrogram(context, clip.spectrogramWaveform, {
				columns: clip.spectrogramColumns, deferAnalysis: clip.spectrogramDeferred,
				width,
				height: splitY,
				backgroundColor: cssColor(style, '--spectrogram-background', '#010101'),
				dividerColor: divider,
				...options.spectrogramOptions,
				channelHeightRatio: options.channelHeightRatio,
			});
		} else {
			releaseSpectrogramCanvas(canvas);
			delete canvas.dataset.spectrogramRenderer;
		}
		const gpuEligible = options.displayMode === 'waveform' && rendering.mode === 'summary' && options.waveformGpuRenderer;
		if (gpuEligible) {
			gpuPainted = options.waveformGpuRenderer.drawFrame(context, rendering, channelGeometry.map((item, channel) => {
				const geometry = audacityWaveformChannelGeometry(item.top, item.height, options.halfWave);
				return { channel, width, ...geometry, pixelRatioX, pixelRatioY, channelTop: item.top, channelHeight: item.height,
					maxAmplitude: geometry.maxAmplitude * verticalMagnification, amplitudeScale, halfWave: options.halfWave,
					envelopeGain, showRms: options.showRms, baseSampleColor: baseWaveform, selectedSampleColor: selectedWaveform,
					baseRmsColor: baseRms, selectedRmsColor: selectedRms, selectionStart: selection.start, selectionEnd: selection.end };
			}), cssColor(style, `--clip-${color}-time-selection-body`, 'rgba(255, 255, 255, 0.15)'));
		} else options.waveformGpuRenderer?.releaseOwner(canvas);
		if (gpuEligible && !gpuPainted) {
			context.restore();
			return drawAudacityClipCanvas(canvas, clip, { ...options, waveformGpuRenderer: null });
		}
		if (options.cacheSelectionLayers !== false) releaseWaveformSelectionLayers(canvas);
		if (!gpuPainted && waveformHeight > 0 && selection.end > selection.start) {
			context.fillStyle = cssColor(style, frequencyDisplay ? '--frequency-selection-body' : `--clip-${color}-time-selection-body`, 'rgba(255, 255, 255, 0.15)');
			context.fillRect(selection.start, splitY, selection.end - selection.start, waveformHeight);
		}
		for (let channel = 0; waveformHeight > 0 && channel < channelCount; channel += 1) {
			const channelTop = splitY + channelGeometry[channel].top;
			const channelHeight = channelGeometry[channel].height;
			const geometry = audacityWaveformChannelGeometry(
				channelTop,
				channelHeight,
				options.halfWave,
			);
			context.save();
			context.beginPath();
			context.rect(0, channelTop, width, channelHeight);
			context.clip();
			const drawingOptions = {
				channel,
				width,
				pixelRatioX,
				...geometry,
				maxAmplitude: geometry.maxAmplitude * verticalMagnification,
				amplitudeScale,
				halfWave: options.halfWave,
				envelopeGain,
				centerLineColor: divider,
				columnRanges: options.columnRanges,
			};
			const channelFrequencyPainted = options.frequencyWaveformRenderer?.drawFrequencyWaveformChannel(
				context, options.displayMode, rendering, clip.frequencyWaveform,
				drawingOptions, style, options.showRms,
			);
			frequencyPainted ||= Boolean(channelFrequencyPainted);
			if (!channelFrequencyPainted && !gpuPainted) {
				drawAudacityWaveformChannel(context, rendering, {
					...drawingOptions,
					sampleColor: waveformColor,
					rmsColor,
					showRms: options.showRms,
				});
			}
			context.restore();
		}
		context.strokeStyle = divider;
		context.lineWidth = 1;
		if (waveformHeight > 0 && channelCount > 1) {
			drawHorizontalCanvasLine(context, splitY + channelGeometry[1].top, width);
		}
		if (splitY > 0 && waveformHeight > 0) {
			context.strokeStyle = splitSeparator;
			drawHorizontalCanvasLine(context, splitY, width);
		}
		context.restore();
	}
	canvas.dataset.waveformRenderer = 'audacity';
	canvas.dataset.waveformMode = rendering.mode;
	canvas.dataset.waveformOwner = 'audacity';
	canvas.dataset.waveformAmplitudeScale = amplitudeScale;
	canvas.dataset.waveformAcceleration = gpuPainted ? 'webgl2' : 'canvas';
	const frequencyMode = frequencyPainted ? options.displayMode : null;
	if (frequencyMode) canvas.dataset.frequencyWaveformMode = frequencyMode;
	else delete canvas.dataset.frequencyWaveformMode;
	canvas.dataset.waveformSource = frequencyMode
		? 'frequency-analysis'
		: options.peakPreview ? 'peak-preview' : rendering.peakBlockSize ? 'peaks' : 'pcm';
	return true;
}

export function clipSelectionPixels(clip, selection, pixelsPerSecond, width) {
	if (!selection) return { start: -1, end: -1 };
	const overlapStart = Math.max(clip.start, selection.startTime);
	const overlapEnd = Math.min(clip.start + clip.duration, selection.endTime);
	if (overlapStart >= overlapEnd) return { start: -1, end: -1 };
	return {
		start: Math.max(0, Math.min(width, (overlapStart - clip.start) * pixelsPerSecond)),
		end: Math.max(0, Math.min(width, (overlapEnd - clip.start) * pixelsPerSecond)),
	};
}

export function cssColor(style, property, fallback) {
	return style.getPropertyValue(property).trim() || fallback;
}

export function drawHorizontalCanvasLine(context, y, width) {
	context.beginPath();
	context.moveTo(0, y);
	context.lineTo(width, y);
	context.stroke();
}
