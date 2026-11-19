/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAudacityLiveEffect, audacityLiveEffectCapability } from './audacity-effects/live-capabilities.js';
import { standardEffectTailSeconds } from './first-party-effects/standard/effect-tail.ts';
import { noiseGateLatencyFrames } from './first-party-effects/standard/noise-gate-definition.ts';
import { standardDelayLatencyFrames } from './first-party-effects/standard/delay-definition.ts';
import { bandDynamicsTailSeconds, isBandDynamicsEffect } from './first-party-effects/dynamics/definition.ts';
import { designParametricEq } from './parametric-eq/design.js';
import { iirReleaseBoundFrames, type NormalizedIirCoefficients } from './first-party-effects/standard/filters-coefficients.ts';

/** Unknown processors and free-running oscillators/RNGs must retain their clock. */
export function idleEffectHoldFrames(type: string, params: Readonly<Record<string, unknown>>, sampleRate: number): number {
	if (['tremolo', 'vocoder', 'bitcrusher', 'hum-removal', 'auto-tune', 'audacity-phaser', 'audacity-wahwah',
		'audacity-click-removal', 'audacity-noise-reduction', 'audacity-filter-curve-eq', 'audacity-graphic-eq'].includes(type)) return Infinity;
	const release = Math.max(0, Number(params.release ?? 0.25), Number(params.hold ?? 0)) * 16 * sampleRate;
	if (type === 'parametric-eq') {
		const sections = designParametricEq(params, sampleRate).sections;
		return iirReleaseBoundFrames(sections.map((section: { coefficients: { b0: number; b1: number; b2: number; a1: number; a2: number } }) => {
			const { b0, b1, b2, a1, a2 } = section.coefficients;
			return [b0, b1, b2, a1, a2] as NormalizedIirCoefficients;
		}));
	}
	if (type === 'delay') {
		// Reserve a complete interval even between sparse feedback repeats.
		return 5 * sampleRate;
	}
	if (type === 'limiter' || type === 'gate') return release + Math.ceil(Number(params.lookahead ?? 0) * sampleRate);
	if (isBandDynamicsEffect(type)) return Math.max(release, bandDynamicsTailSeconds(type, params, sampleRate) * sampleRate);
	const standardTail = standardEffectTailSeconds(type, params, sampleRate);
	if (standardTail !== null) {
		if (type === 'multi-tap-delay' && Number(params.pitchShift ?? 0) !== 0) return Infinity;
		const latency = type === 'noise-gate' ? noiseGateLatencyFrames(params, sampleRate)
			: type === 'multi-tap-delay' ? standardDelayLatencyFrames(params, sampleRate) : 0;
		return Math.max(release, standardTail * sampleRate + latency);
	}
	if (isAudacityLiveEffect(type)) {
		const capability = audacityLiveEffectCapability(type);
		const envelopeRelease = 16 * sampleRate * Number(params.releaseMs ?? 1000) / 1000;
		return Math.max(envelopeRelease, capability.latencyFrames(sampleRate, params) + capability.tailFrames(sampleRate, params));
	}
	return Infinity;
}
