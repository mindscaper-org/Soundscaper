/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeMatchEqProfile } from './definition.ts';
import type { MatchEqAnalysis } from './selection.ts';

export interface MatchEqPreviewReport {
	readonly trackName: string;
	readonly sampleRate: number;
	readonly analysis: MatchEqAnalysis;
}

/** Worker output is validated again before it can become a reusable profile or EQ. */
export function matchEqPreviewReports(result: unknown): readonly MatchEqPreviewReport[] | null {
	if (!result || typeof result !== 'object' || !('matchEqAnalysis' in result)) return null;
	const reports = result.matchEqAnalysis;
	if (!Array.isArray(reports) || !reports.length || reports.length > 1024) return null;
	try {
		return reports.map((report: unknown) => {
			if (!report || typeof report !== 'object') throw new TypeError('Invalid Match EQ report.');
			const value = report as Partial<MatchEqPreviewReport>;
			if (typeof value.trackName !== 'string' || !Number.isInteger(value.sampleRate) || Number(value.sampleRate) < 8000
				|| Number(value.sampleRate) > 384000 || !value.analysis || !Array.isArray(value.analysis.curve)
				|| value.analysis.curve.length > 128) throw new TypeError('Invalid Match EQ report.');
			let previous = 0;
			const curve = value.analysis.curve.map(point => {
				if (!Number.isFinite(point?.frequency) || point.frequency <= previous || point.frequency > 20000
					|| !Number.isFinite(point.gain) || Math.abs(point.gain) > 18) throw new TypeError('Invalid Match EQ curve.');
				previous = point.frequency;
				return Object.freeze({ frequency: point.frequency, gain: point.gain });
			});
			return Object.freeze({ trackName: value.trackName, sampleRate: value.sampleRate!,
				analysis: Object.freeze({ profile: normalizeMatchEqProfile(value.analysis.profile), curve: Object.freeze(curve) }) });
		});
	} catch { return null; }
}

/** A/B gain compensation is temporary; applied PCM and saved parameters retain the EQ alone. */
export function levelMatchEqPreview(output: Float32Array[], input: Float32Array[], maximumFrames: number): Float32Array[] {
	let before = 0, after = 0;
	for (let channel = 0; channel < output.length; channel++) {
		const source = input[channel]!, destination = output[channel]!;
		for (let frame = 0; frame < Math.min(maximumFrames, destination.length, source.length); frame++) {
			before += source[frame]! ** 2; after += destination[frame]! ** 2;
		}
	}
	const gain = before > 0 && after > 0 ? Math.max(.125, Math.min(8, Math.sqrt(before / after))) : 1;
	return output.map(channel => channel.map(value => value * gain));
}
