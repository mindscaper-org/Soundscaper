/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useRef } from 'react';
import { clipSourceDisplayRange } from '../../clip-source-timing.ts';
import { useSpectrogramPcmTiles } from '../timeline/useSpectrogramPcmTiles.ts';
import type { clipSourceWaveformModels } from './clip-source-waveform-model.ts';

/** Only the active source segment carries clip processing; unused media stays raw. */
export function useClipSourceSpectrogramTiles(options: Parameters<typeof clipSourceWaveformModels>[0],
	models: ReturnType<typeof clipSourceWaveformModels>['models']) {
	const { clip, project, source, visual, startFrame, endFrame, width, displayMode } = options;
	const rendered = Boolean(visual.prepareSpectrogramPcm) && (displayMode === 'spectrogram' || displayMode === 'multiview');
	const currentVisual = useRef(visual); currentVisual.current = visual;
	const controller = useMemo(() => ({ getClipVisualData: () => currentVisual.current,
		actions: { timeline: { requestWaveformPcmWindow: () => null } } }), []);
	const range = clipSourceDisplayRange(clip, source, project.sampleRate);
	const localStart = Math.max(0, startFrame - range.startFrame);
	const localEnd = Math.min(clip.durationFrames, endFrame - range.startFrame);
	const clips = useMemo(() => rendered && localEnd > localStart
		? [{ ...clip, waveformStartFrame: localStart, waveformEndFrame: localEnd }] : [], [clip, rendered, localStart, localEnd]);
	const sourceLookup = useMemo(() => new Map([[source.id, source]]), [source]);
	const columns = useSpectrogramPcmTiles({ controller, projectedClips: clips, sourceLookup, project,
		pixelsPerSecond: width * project.sampleRate / (endFrame - startFrame), sampleRate: project.sampleRate,
		displayMode: rendered ? displayMode : 'waveform', fftWindowSize: 2048, windowType: 'hann', visualRevision: visual });
	return models.map(model => model.selected && rendered ? { ...model,
		spectrogramColumns: columns.get(clip.id), spectrogramDeferred: !columns.has(clip.id) } : model);
}
