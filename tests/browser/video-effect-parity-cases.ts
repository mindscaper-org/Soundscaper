/* SPDX-License-Identifier: AGPL-3.0-only */

import { videoEffectDefaults } from '../../src/common/editor/video-effects.js';

export interface VideoEffectParityEffect {
	readonly id: string;
	readonly type: string;
	readonly enabled: true;
	readonly params: Readonly<Record<string, unknown>>;
}
export interface VideoEffectParityCase {
	readonly name: string;
	readonly fixture: 'gradient' | 'color-chart' | 'edge' | 'transparency';
	readonly effects: readonly VideoEffectParityEffect[];
}

// Calibrated against these two original VFX batches. New registrations must
// add their own active fixture below instead of changing a historical recipe.
const FIRST_BATCH = ['color-adjust', 'pixelate', 'vignette', 'gaussian-blur', 'sharpen', 'rgb-split'] as const;
const SECOND_BATCH = ['chroma-key', 'luma-key', 'spill-suppression', 'glow', 'outline', 'drop-shadow'] as const;

export const DEVELOP_ACTIVE_PARITY_CASES: readonly VideoEffectParityCase[] = Object.freeze([
	parityCase('develop-active-white-balance-v1', 'color-chart', effect('white-balance-v1', { temperature: 73, tint: -41 })),
	parityCase('develop-active-tone-ladder-v1', 'color-chart', effect('tone-ladder-v1', { exposure: 0.37, contrast: 29, highlights: -63, shadows: 47, whites: 21, blacks: -33 })),
	parityCase('develop-active-geometry-v1', 'gradient', effect('develop-geometry-v1', { cropX: 0.125, cropY: 0.125, cropWidth: 0.75, cropHeight: 0.75, rotationDegrees: 15 })),
	parityCase('develop-active-chroma-v1', 'color-chart', effect('chroma-v1', { saturation: 33.3, vibrance: 100 })),
	parityCase('develop-active-black-white-v1', 'color-chart', effect('black-white-mix-v1', { red: 12.5, orange: -37.125 })),
	parityCase('develop-active-hsl-v1', 'color-chart', effect('hsl-mixer-v1', { redHue: 37.125, orangeSaturation: -50, greenLuminance: 25 })),
	parityCase('develop-active-point-curves-v1', 'gradient', effect('point-curves-v1', { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] })),
	parityCase('develop-active-parametric-curves-v1', 'color-chart', effect('parametric-curves-v1', { masterShadows: 50, redHighlights: -25 })),
	parityCase('develop-active-color-wheels-v1', 'color-chart', effect('color-wheels-v1', { highlightsLuminance: 100 })),
	parityCase('develop-active-detail-sharpen-v1', 'edge', effect('detail-sharpen-v1', { amount: 100, threshold: 0 })),
	parityCase('develop-active-post-crop-vignette-v1', 'gradient', effect('post-crop-vignette-v1', { amount: -50, midpoint: 25, highlights: 20 })),
	parityCase('develop-active-clarity-v1', 'edge', effect('clarity-v1', { amount: 50 })),
	parityCase('develop-active-noise-reduction-v1', 'edge', effect('noise-reduction-v1', { luminance: 100, luminanceDetail: 0, color: 100, colorDetail: 0, colorSmoothness: 100 })),
	parityCase('develop-active-grain-v1', 'gradient', effect('grain-v1', { amount: 50, size: 1, roughness: 50, seed: 2718 })),
	parityCase('develop-active-texture-v1', 'edge', effect('texture-v1', { amount: 50 })),
	parityCase('develop-active-dehaze-v1', 'color-chart', effect('dehaze-v1', { amount: 50 })),
	parityCase('develop-active-lens-distortion-v1', 'gradient', effect('lens-distortion-v1', { amount: 25 })),
	parityCase('develop-active-chromatic-aberration-v1', 'edge', effect('chromatic-aberration-v1', { red: 25, blue: -25 })),
	parityCase('develop-active-defringe-v1', 'color-chart', effect('defringe-v1', { purple: 100, green: 100, edgeThreshold: 0 })),
	parityCase('develop-active-optical-vignette-v1', 'gradient', effect('optical-vignette-v1', { amount: -50 })),
]);
const DEVELOP_TYPES = DEVELOP_ACTIVE_PARITY_CASES.map(row => row.effects[0]!.type);

export const PARITY_CASES = Object.freeze([
	parityCase('color-adjust-default', 'color-chart', effect('color-adjust')),
	parityCase('transparency-baseline', 'transparency'),
	parityCase('color-adjust-upper-boundaries', 'color-chart', effect('color-adjust', {
		brightness: 1,
		contrast: 2,
		saturation: 3,
		gamma: 4,
		hueDegrees: 180,
	})),
	parityCase('color-adjust-lower-boundaries', 'color-chart', effect('color-adjust', {
		brightness: -1,
		contrast: 0,
		saturation: 0,
		gamma: 0.25,
		hueDegrees: -180,
	})),
	parityCase('color-adjust-eq-upper-boundaries', 'color-chart', effect('color-adjust', {
		brightness: 1,
		contrast: 2,
		saturation: 3,
		gamma: 4,
		hueDegrees: 0,
	})),
	parityCase('color-adjust-hue-boundary', 'color-chart', effect('color-adjust', {
		hueDegrees: 180,
	})),
	parityCase('pixelate-default', 'gradient', effect('pixelate')),
	parityCase('pixelate-lower-boundary', 'gradient', effect('pixelate', { blockSize: 2 })),
	parityCase('pixelate-upper-boundary', 'color-chart', effect('pixelate', { blockSize: 128 })),
	parityCase('vignette-default', 'gradient', effect('vignette')),
	parityCase('vignette-default-transparency', 'transparency', effect('vignette')),
	parityCase('vignette-lower-boundary', 'transparency', effect('vignette', { amount: 0 })),
	parityCase('vignette-upper-boundary', 'gradient', effect('vignette', { amount: 1 })),
	parityCase('gaussian-blur-default', 'edge', effect('gaussian-blur')),
	parityCase('gaussian-blur-lower-boundary', 'edge', effect('gaussian-blur', { sigma: 0 })),
	parityCase('gaussian-blur-upper-boundary', 'edge', effect('gaussian-blur', { sigma: 20 })),
	parityCase('sharpen-default', 'edge', effect('sharpen')),
	parityCase('sharpen-zero-control', 'gradient', effect('sharpen', { amount: 0 })),
	parityCase('sharpen-upper-boundary', 'edge', effect('sharpen', { amount: 2 })),
	parityCase('rgb-split-default', 'transparency', effect('rgb-split')),
	parityCase('rgb-split-default-opaque', 'gradient', effect('rgb-split')),
	parityCase('rgb-split-boundaries', 'transparency', effect('rgb-split', {
		offsetX: 64,
		offsetY: -64,
	})),
	parityCase('rgb-split-opposite-boundaries', 'transparency', effect('rgb-split', {
		offsetX: -64,
		offsetY: 64,
	})),
	parityCase('chroma-key-default', 'color-chart', effect('chroma-key')),
	parityCase('chroma-key-default-gradient', 'gradient', effect('chroma-key')),
	parityCase('chroma-key-hard-boundary', 'color-chart', effect('chroma-key', { similarity: 0.01, softness: 0 })),
	parityCase('chroma-key-wide-boundary', 'color-chart', effect('chroma-key', { similarity: 1, softness: 1 })),
	parityCase('luma-key-dark-default', 'gradient', effect('luma-key')),
	parityCase('luma-key-bright', 'gradient', effect('luma-key', { mode: 1, cutoff: 0.8 })),
	parityCase('spill-suppression-default', 'color-chart', effect('spill-suppression')),
	parityCase('spill-suppression-blue-boundary', 'color-chart', effect('spill-suppression', { screen: 1, strength: 1 })),
	parityCase('glow-default', 'edge', effect('glow')),
	parityCase('glow-upper-boundary', 'edge', effect('glow', { threshold: 0, sigma: 20, intensity: 1 })),
	parityCase('outline-default', 'transparency', effect('outline')),
	parityCase('outline-upper-boundary', 'transparency', effect('outline', { width: 16, color: 0xff0080, opacity: 1 })),
	parityCase('drop-shadow-default', 'transparency', effect('drop-shadow')),
	parityCase('drop-shadow-hard-boundary', 'transparency', effect('drop-shadow', { offsetX: -64, offsetY: 64, sigma: 0, opacity: 1, color: 0x4080ff })),
	parityCase(
		'first-batch-default-stack',
		'gradient',
		...FIRST_BATCH.map((type) => effect(type)),
	),
	parityCase(
		'second-batch-default-stack',
		'gradient',
		...SECOND_BATCH.map((type) => effect(type)),
	),
	...DEVELOP_ACTIVE_PARITY_CASES,
	parityCase('develop-bw-detail-stack', 'gradient', effect('black-white-mix-v1'), effect('detail-sharpen-v1')),
	parityCase('legacy-second-batch-bw-stack', 'gradient', ...SECOND_BATCH.map(type => effect(type)), effect('black-white-mix-v1')),
	parityCase(
		'keying-default-stack',
		'gradient',
		effect('chroma-key'),
		effect('luma-key'),
	),
]);


export const SCALED_PARITY_CASES = Object.freeze([
	['scaled-letterboxed-first-batch-stack', FIRST_BATCH.map((type) => effect(type))] as const,
	...[...SECOND_BATCH, ...DEVELOP_TYPES].map((type) => [`scaled-letterboxed-${type}`, [effect(type)]] as const),
]);


function parityCase(name: string, fixture: VideoEffectParityCase['fixture'], ...effects: VideoEffectParityEffect[]): VideoEffectParityCase {
	return Object.freeze({ name, fixture, effects: Object.freeze(effects) });
}

export function effect(type: string, params: Readonly<Record<string, unknown>> = {}): VideoEffectParityEffect {
	return Object.freeze({
		id: `parity-${type}`,
		type,
		enabled: true,
		params: Object.freeze({ ...videoEffectDefaults(type), ...params }),
	});
}

