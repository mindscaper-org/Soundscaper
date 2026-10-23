/* SPDX-License-Identifier: AGPL-3.0-only */
import { createSpectrogramCanvasOptions } from '../timeline/spectrogram-canvas-options.ts';

/** Projected FFT samples use the timeline clock, including unprocessed source segments. */
export function clipSourceSpectrogramOptions(projectSampleRate: number, sourceSampleRate: number) {
	return createSpectrogramCanvasOptions({ scale: 'linear', maximumFrequency: sourceSampleRate / 2 }, projectSampleRate);
}
