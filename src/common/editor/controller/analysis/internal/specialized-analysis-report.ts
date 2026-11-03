/* SPDX-License-Identifier: AGPL-3.0-only */

import { clippingReport, spectrumReport } from '../../../specialized-audio-analysis.ts';
import { createLocalizedError } from '../../../../i18n/presentation-message.ts';
import type { AnalysisDependencies, AnalysisRange } from '../analysis-service.ts';

export interface SpectrumTrack {
	readonly id: string;
	readonly name: string;
	readonly color: string;
}

interface SpecializedRequest {
	readonly type: 'spectrum' | 'clipping';
	readonly scope: string;
	readonly range: AnalysisRange;
	readonly options: Readonly<Record<string, unknown>>;
	readonly tracks: readonly SpectrumTrack[];
	readonly signal: AbortSignal;
}

/** Render serially to retain only one track's PCM while collecting immutable reports. */
export async function renderSpecializedAnalysis(
	request: SpecializedRequest,
	dependencies: Pick<AnalysisDependencies, 'copy' | 'createVisuals' | 'createSpecializedReport'>,
	render: (scope: string, trackId?: string | null) => Promise<{ channels: Float32Array[]; sampleRate: number }>,
	assertCurrent: () => void,
) {
	const { type, scope, range, options, signal } = request;
	const createReport = async (reportScope: string, trackId?: string | null, includeVisuals = false) => {
		const { channels, sampleRate } = await render(reportScope, trackId);
		if (type === 'spectrum' && (channels[0]?.length ?? 0) < Number(options.size)) {
			throw createLocalizedError(RangeError, dependencies.copy, 'spectrumSelectionTooShort', { samples: Number(options.size) });
		}
		const visuals = includeVisuals ? dependencies.createVisuals(channels, sampleRate) : null;
		const report = dependencies.createSpecializedReport
			? await dependencies.createSpecializedReport(type, reportScope, range, channels, sampleRate, options, signal)
			: type === 'spectrum' ? spectrumReport(reportScope, range, channels, sampleRate, options)
				: clippingReport(reportScope, range, channels, options);
		assertCurrent();
		return { report, visuals };
	};
	const combined = await createReport(scope, undefined, true);
	if (request.tracks.length < 2) return combined;
	const tracks = [];
	for (const track of request.tracks) {
		const { report } = await createReport('track', track.id);
		tracks.push(Object.freeze({ ...reportRecord(report), trackId: track.id, name: track.name, color: track.color }));
	}
	return { ...combined, report: Object.freeze({ ...reportRecord(combined.report), tracks: Object.freeze(tracks) }) };
}

function reportRecord(report: unknown): Record<string, unknown> {
	if (!report || typeof report !== 'object' || Array.isArray(report)) throw new TypeError('Invalid spectrum report.');
	return report as Record<string, unknown>;
}
