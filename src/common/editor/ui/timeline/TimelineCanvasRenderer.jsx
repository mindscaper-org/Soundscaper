import { useEditorSkin } from '../skins/EditorSkinProvider.tsx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@soundscaper/design-system/ThemeProvider';

import {
	preparePffftSpectrogram,
} from '../../pffft-spectrogram.js';
import { useRetainedCanvasFrame } from './useRetainedCanvasFrame.ts';
import { readWaveformCanvasMeasurements } from './waveform-canvas-measurements.ts';
import { createWaveformGpuDisplay } from '../../design-system-adapters/waveform-gpu-display.ts';
import { releaseWaveformSelectionLayers } from './waveform-selection-layers.ts';
import { reprojectPendingWaveform } from './waveform-plan-continuity.ts';
import { spectrogramCanvasDrawKey } from './spectrogram-canvas-options.ts';
import { releaseSpectrogramCanvas } from './spectrogram-canvas-renderer.js';
import { clipSelectionPixels, drawAudacityClipCanvas } from './waveform-canvas-renderer.js';
import { useSpectrogramCanvasRevision } from './useSpectrogramCanvasRevision.ts';
export { drawAudacityClipSpectrogram } from './spectrogram-canvas-renderer.js';
export { clipSelectionPixels, cssColor, drawAudacityClipCanvas, drawHorizontalCanvasLine } from './waveform-canvas-renderer.js';

export function AudacityWaveformCanvases({
	rootRef,
	clips,
	displayMode,
	pixelsPerSecond,
	timeSelection,
	showRms,
	halfWave,
	waveformRulerFormat = 'linear-db',
	waveformRenderer = 'canvas',
	verticalZoom,
	channelHeightRatio,
	spectrogramOptions,
}) {
	const paintedCanvases = useRef(new Set());
	const scheduleDraw = useRetainedCanvasFrame(rootRef);
	useEffect(() => () => {
		for (const canvas of paintedCanvases.current) { releaseSpectrogramCanvas(canvas); releaseWaveformSelectionLayers(canvas); }
		paintedCanvases.current.clear();
	}, []);
	const { theme } = useTheme();
	const { skin, decoration, mode } = useEditorSkin();
	const themeDrawKey = `${skin}|${decoration}|${mode}|${theme.background.canvas.default}|${theme.foreground.text.primary}`;
	const {
		scale,
		minFreq,
		maxFreq,
		fftWindowSize,
		windowType,
		gainDb,
		rangeDb,
		sampleRate,
	} = spectrogramOptions;
	const renderSpectrogramOptions = useMemo(() => ({
		scale,
		minFreq,
		maxFreq,
		fftWindowSize,
		windowType,
		gainDb,
		rangeDb,
		sampleRate,
	}), [fftWindowSize, gainDb, maxFreq, minFreq, rangeDb, sampleRate, scale, windowType]);
	const spectrogramDrawKey = useMemo(() => spectrogramCanvasDrawKey(renderSpectrogramOptions), [renderSpectrogramOptions]);
	const spectrogramRevision = useSpectrogramCanvasRevision(displayMode === 'spectrogram' || displayMode === 'multiview');
	const [frequencyWaveformRenderer, setFrequencyWaveformRenderer] = useState(null);
	const [gpuRenderer, setGpuRenderer] = useState(null);
	const [gpuRevision, setGpuRevision] = useState(0);
	useEffect(() => {
		if (waveformRenderer !== 'gpu') return undefined;
		let active = true;
		let lease = null;
		void import('../../controller/source/waveform-gpu-renderer.ts').then((module) => {
			if (!active) return;
			const owner = rootRef.current?.ownerDocument;
			if (!owner) return;
			lease = module.acquireWaveformGpuRenderer(owner, () => owner.createElement('canvas'),
				() => setGpuRevision(value => value + 1), createWaveformGpuDisplay);
			setGpuRenderer(lease);
			setGpuRevision(value => value + 1);
		}).catch(() => {});
		return () => { active = false; lease?.release(); };
	}, [rootRef, waveformRenderer]);
	useEffect(() => {
		if ((displayMode !== 'waveform-three-band' && displayMode !== 'waveform-rainbow')
			|| frequencyWaveformRenderer) return undefined;
		let active = true;
		void import('./frequency-waveform-renderer.ts').then((module) => {
			if (active) setFrequencyWaveformRenderer(module);
		}).catch(() => {});
		return () => { active = false; };
	}, [displayMode, frequencyWaveformRenderer]);
	useEffect(() => {
		if (displayMode !== 'spectrogram' && displayMode !== 'multiview') return;
		preparePffftSpectrogram(renderSpectrogramOptions.fftWindowSize).catch(() => {});
	}, [displayMode, renderSpectrogramOptions.fftWindowSize]);
	useLayoutEffect(() => {
		const draw = () => {
			const root = rootRef.current;
			if (!root) return;
			const clipById = new Map(clips.map((clip) => [String(clip.id), clip]));
			const editorRoot = root.closest('#kw-audio-editor-design-system');
			const drawKey = [
				displayMode,
				pixelsPerSecond,
				showRms,
				halfWave,
				waveformRulerFormat,
				waveformRenderer, gpuRevision,
				verticalZoom,
				channelHeightRatio,
				spectrogramDrawKey,
				spectrogramRevision,
				themeDrawKey,
				editorRoot?.dataset.editorTheme || '',
			].join('|');
			const liveCanvases = new Set();
			const measurements = readWaveformCanvasMeasurements(root, normalizeAudacityCanvasStyle);
			for (const { canvas, clipId, bounds, style } of measurements) {
				const clip = clipById.get(clipId);
				liveCanvases.add(canvas);
				if (waveformRenderer !== 'gpu') gpuRenderer?.releaseOwner(canvas);
				if (!clip) { gpuRenderer?.releaseOwner(canvas); resetAudacityClipCanvas(canvas); continue; }
				const selection = clipSelectionPixels(clip, timeSelection, pixelsPerSecond, bounds.width);
				const clipDrawKey = `${drawKey}|${selection.start}|${selection.end}`;
				const canvasDrawKey = audacityCanvasDrawKey(canvas, clip, clipDrawKey, bounds);
				const drawOptions = {
					displayMode,
					pixelsPerSecond,
					timeSelection,
					showRms,
					halfWave,
					waveformRulerFormat,
					verticalZoom,
					channelHeightRatio,
					frequencyWaveformRenderer,
					waveformGpuRenderer: waveformRenderer === 'gpu' ? gpuRenderer : null,
					spectrogramOptions: renderSpectrogramOptions,
					bounds, style,
				};
				if (!clip.audacityWaveform) {
					const oldPlan = canvas.__kwWaveformPlan;
					if (clip.waveformPending && oldPlan && canvas.__kwWaveformState === 'pending'
						&& canvas.__kwWaveformDrawKey === canvasDrawKey
						&& canvas.__kwFrequencyWaveformRenderer === frequencyWaveformRenderer
						&& canvas.__kwPendingFrequencyWaveform === clip.frequencyWaveform) continue;
					const pendingPlan = clip.waveformPending && oldPlan
						? reprojectPendingWaveform(oldPlan, clip, renderSpectrogramOptions.sampleRate, bounds.width)
						: null;
					if (pendingPlan) {
						try {
							const drawn = drawAudacityClipCanvas(canvas, {
								...clip,
								audacityWaveform: pendingPlan,
								frequencyWaveform: clip.frequencyWaveform || frequencyWaveformRenderer?.reprojectPendingFrequencyWaveform?.(
									canvas.__kwFrequencyWaveformPlan, pendingPlan,
								),
							}, { ...drawOptions, peakPreview: peakPlanNeedsPreview(oldPlan, bounds.width) });
							if (drawn) {
								canvas.__kwWaveformDrawKey = audacityCanvasDrawKey(canvas, clip, clipDrawKey, bounds);
								canvas.__kwWaveformState = 'pending';
								canvas.__kwFrequencyWaveformRenderer = frequencyWaveformRenderer;
								canvas.__kwPendingFrequencyWaveform = clip.frequencyWaveform;
								delete canvas.dataset.waveformError;
							}
						} catch (error) {
							canvas.dataset.waveformError = error instanceof Error ? error.message : String(error);
						}
						canvas.dataset.waveformPending = 'true';
						continue;
					}
					gpuRenderer?.releaseOwner(canvas); resetAudacityClipCanvas(canvas);
					if (clip.waveformError) canvas.dataset.waveformError = clip.waveformError;
					continue;
				}
				if (audacityCanvasPlansAreCurrent(canvas, clip, canvasDrawKey, frequencyWaveformRenderer)
					&& canvas.__kwWaveformState === 'audacity') continue;
				try {
					const drawn = drawAudacityClipCanvas(canvas, clip, {
						...drawOptions,
						peakPreview: peakPlanNeedsPreview(clip.audacityWaveform, bounds.width),
					});
					if (drawn) {
						canvas.__kwWaveformPlan = clip.audacityWaveform;
						canvas.__kwSpectrogramColumnsPlan = clip.spectrogramColumns;
						canvas.__kwFrequencyWaveformPlan = clip.frequencyWaveform;
						canvas.__kwFrequencyWaveformRenderer = frequencyWaveformRenderer;
						canvas.__kwWaveformDrawKey = audacityCanvasDrawKey(canvas, clip, clipDrawKey, bounds);
						canvas.__kwWaveformState = 'audacity';
						delete canvas.dataset.waveformError;
						if (clip.waveformPending) canvas.dataset.waveformPending = 'true';
						else delete canvas.dataset.waveformPending;
					}
				} catch (error) {
					resetAudacityClipCanvas(canvas);
					canvas.dataset.waveformError = error instanceof Error ? error.message : String(error);
				}
			}
			for (const canvas of paintedCanvases.current) {
				if (!liveCanvases.has(canvas)) { gpuRenderer?.releaseOwner(canvas); releaseSpectrogramCanvas(canvas); releaseWaveformSelectionLayers(canvas); }
			}
			paintedCanvases.current = liveCanvases;
		};
		scheduleDraw(draw);
	}, [channelHeightRatio, clips, displayMode, frequencyWaveformRenderer, gpuRenderer, gpuRevision, halfWave, pixelsPerSecond, renderSpectrogramOptions, rootRef, scheduleDraw, showRms, spectrogramDrawKey, spectrogramRevision, themeDrawKey, timeSelection, verticalZoom, waveformRenderer, waveformRulerFormat]);
	return null;
}

export function normalizeAudacityCanvasStyle(canvas) {
	if (canvas.style.width) canvas.style.removeProperty('width');
	if (canvas.style.height) canvas.style.removeProperty('height');
}

function peakPlanNeedsPreview(plan, liveWidth) {
	if (!plan?.peakBlockSize) return false;
	const projectedBucketWidth = plan.peakBlockSize * plan.pixelsPerSample
		* liveWidth / plan.pixelWidth;
	return liveWidth > plan.pixelWidth || !(projectedBucketWidth <= 1);
}

export function resetAudacityClipCanvas(canvas) {
	releaseSpectrogramCanvas(canvas);
	releaseWaveformSelectionLayers(canvas);
	delete canvas.dataset.waveformError;
	delete canvas.dataset.waveformPending;
	const context = canvas.getContext('2d', { alpha: true });
	if (context) {
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.restore();
	}
	delete canvas.__kwWaveformPlan;
	delete canvas.__kwSpectrogramColumnsPlan;
	delete canvas.__kwFrequencyWaveformPlan;
	delete canvas.__kwFrequencyWaveformRenderer;
	delete canvas.__kwPendingFrequencyWaveform;
	delete canvas.__kwWaveformDrawKey;
	canvas.__kwWaveformState = 'empty';
	delete canvas.dataset.waveformRenderer;
	delete canvas.dataset.waveformMode;
	delete canvas.dataset.waveformOwner;
	delete canvas.dataset.waveformSource;
	delete canvas.dataset.spectrogramRenderer;
	delete canvas.dataset.frequencyWaveformMode;
	delete canvas.dataset.waveformAmplitudeScale;
	delete canvas.dataset.waveformAcceleration;
}

export function audacityCanvasDrawKey(canvas, clip, drawKey, bounds = canvas.getBoundingClientRect()) {
	return [
		drawKey,
		clip.color || '',
		clip.sourceId,
		clip.waveformStartFrame,
		clip.waveformEndFrame,
		clip.start,
		clip.duration,
		clip.trimStart,
		clip.waveformIdentity,
		bounds.width,
		bounds.height,
		canvas.width,
		canvas.height,
		window.devicePixelRatio || 1,
	].join('|');
}

export function audacityCanvasPlansAreCurrent(canvas, clip, canvasDrawKey, frequencyWaveformRenderer) {
	return canvas.__kwWaveformPlan === clip.audacityWaveform
		&& canvas.__kwSpectrogramColumnsPlan === clip.spectrogramColumns
		&& canvas.__kwFrequencyWaveformPlan === clip.frequencyWaveform
		&& canvas.__kwFrequencyWaveformRenderer === frequencyWaveformRenderer
		&& canvas.__kwWaveformDrawKey === canvasDrawKey;
}
