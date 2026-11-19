/* SPDX-License-Identifier: AGPL-3.0-only */

import { applyAudacityFilterCurveEq } from '../../audacity-effects/spectral.js';
import type { FilterCurvePoint } from '../../audacity-effects/filter-curve.ts';
import { assertMatchEqCurrent, learnMatchEqProfile, type MatchEqAnalysisContext } from './analysis.ts';
import { deriveMatchEqCurve } from './curve.ts';
import { normalizeMatchEqParams, type MatchEqProfile } from './definition.ts';
import { matchEqError } from './errors.ts';

export interface MatchEqAnalysis {
	readonly profile: MatchEqProfile;
	readonly curve: readonly FilterCurvePoint[];
}

export interface MatchEqContext extends MatchEqAnalysisContext {
	readonly matchEqCaptureReference?: boolean;
	readonly matchEqAnalyzeOnly?: boolean;
	readonly onMatchEqAnalysis?: (analysis: MatchEqAnalysis) => void;
}

export async function applyMatchEq(channels: Float32Array[], sampleRate: number,
	options: Readonly<Record<string, unknown>> = {}, context: MatchEqContext = {}): Promise<Float32Array[]> {
	const params = normalizeMatchEqParams(options);
	if (!context.matchEqCaptureReference && !params.reference) throw matchEqError('effectMatchEqReferenceMissing');
	const profile = await learnMatchEqProfile(channels, sampleRate, context);
	const curve = context.matchEqCaptureReference ? [] : deriveMatchEqCurve(params.reference!, profile, params);
	assertMatchEqCurrent(context);
	context.onMatchEqAnalysis?.({ profile, curve });
	if (context.matchEqCaptureReference || context.matchEqAnalyzeOnly || params.amount === 0 || params.maxGainDb === 0) return channels.map(channel => channel.slice());
	const output = applyAudacityFilterCurveEq(channels, sampleRate, { points: curve, filterLength: 8191, linearFrequencyScale: false });
	assertMatchEqCurrent(context);
	return output;
}
