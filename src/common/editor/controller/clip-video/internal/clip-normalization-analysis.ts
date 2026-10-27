/* SPDX-License-Identifier: AGPL-3.0-only */

import { analyzeChannelsInWorker } from '../../source/waveform-analysis.ts';
import type { ClipAnalysisResult } from './clip/clip-property-service.ts';

type Copy = Parameters<typeof analyzeChannelsInWorker>[2];

/** Peak is independent of channel layout and of the programme loudness window. */
export async function analyzeClipNormalizationChannels(channels: readonly Float32Array[], sampleRate: number,
	copy: Copy, signal: AbortSignal, peakOnly = false): Promise<ClipAnalysisResult> {
	return normalizationResult(await analyzeChannelsInWorker([...channels], sampleRate, copy, 65_536, signal,
		peakOnly ? { samplePeakOnly: true } : {}));
}

function normalizationResult(analysis: unknown): ClipAnalysisResult {
	if (!analysis || typeof analysis !== 'object') throw new TypeError('Clip analysis returned no measurement.');
	const { peakAmplitude, integratedLufs } = analysis as Partial<ClipAnalysisResult>;
	if (typeof peakAmplitude !== 'number' || (typeof integratedLufs !== 'number' && integratedLufs !== null)) {
		throw new TypeError('Clip analysis returned no peak or loudness measurement.');
	}
	return { peakAmplitude, integratedLufs };
}
