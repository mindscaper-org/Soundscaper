/* SPDX-License-Identifier: AGPL-3.0-only */

export interface StreamedEffectStep { readonly type: string; readonly params: Readonly<Record<string, unknown>>; readonly context?: Readonly<Record<string, unknown>> | null }
export const STREAMED_EFFECT_CHUNK_FRAMES = 65_536;
const causal = new Set(['audacity-invert', 'audacity-bass-treble', 'audacity-distortion', 'audacity-echo', 'audacity-phaser',
	'audacity-wahwah', 'audacity-classic-filters', 'audacity-reverb', 'highpass-filter', 'lowpass-filter', 'notch-filter',
	'shelf-filter', 'tremolo', 'vocoder', 'hum-removal', 'bitcrusher', 'deesser', 'multiband-compressor']);
const buffered = new Set(['audacity-noise-reduction', 'audacity-fade-in', 'audacity-fade-out', 'audacity-click-removal', 'eq', 'noise-gate', 'audacity-compressor', 'audacity-limiter', 'audacity-filter-curve-eq', 'audacity-graphic-eq']);
export function isStreamedGainEffect(type: string): boolean { return type === 'audacity-normalize' || type === 'audacity-loudness-normalization' || type === 'audacity-amplify' || type === 'audacity-remove-dc-offset'; }
/** Offline admission is independent of realtime-only parameter ranges and selection size. */
export function canStreamSelectionEffect(type: string, params: Readonly<Record<string, unknown>>): boolean {
	return type === 'audacity-auto-duck' && Number(params.maximumPause ?? 1) <= 7
		&& Math.max(Number(params.maximumPause ?? 1), Number(params.outerFadeDown ?? .5) + Number(params.outerFadeUp ?? .5)) + Number(params.innerFadeUp ?? 0) <= 10 || causal.has(type) || buffered.has(type) || isStreamedGainEffect(type)
		|| type === 'multi-tap-delay' && Number(params.pitchShift ?? 0) === 0 && params.duration !== 'extend';
}
/** A causal rack keeps its authored prefix; analysis steps form staging barriers. */
export function canStreamEffectMacro(effects: readonly StreamedEffectStep[]): boolean {
	return effects.length > 0 && effects.every(effect => causal.has(effect.type) || isStreamedGainEffect(effect.type));
}
