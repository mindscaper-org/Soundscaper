/* SPDX-License-Identifier: AGPL-3.0-only */

export type SpectrogramScale = 'linear' | 'logarithmic' | 'mel' | 'bark' | 'erb' | 'period';

/** The existing renderer and ruler scale, including the retained log spelling. */
export function normalizeSpectrogramScale(value: unknown): SpectrogramScale {
	const scale = String(value || 'mel').toLowerCase();
	if (scale === 'log') return 'logarithmic';
	return isSpectrogramScale(scale) ? scale : 'mel';
}

function isSpectrogramScale(value: string): value is SpectrogramScale {
	return ['linear', 'logarithmic', 'mel', 'bark', 'erb', 'period'].includes(value);
}
