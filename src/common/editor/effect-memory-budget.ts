/* SPDX-License-Identifier: AGPL-3.0-only */
export const BROWSER_EFFECT_PEAK_MEMORY_LIMIT_BYTES = 256 * 1024 ** 2;
export const DEFAULT_EFFECT_MEMORY_LIMIT_GIB = 4;
export const MAXIMUM_EFFECT_MEMORY_LIMIT_GIB = Math.floor(Number.MAX_SAFE_INTEGER / 1024 ** 3);

export function normalizeEffectMemoryLimitGiB(value: unknown = DEFAULT_EFFECT_MEMORY_LIMIT_GIB): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAXIMUM_EFFECT_MEMORY_LIMIT_GIB) {
		throw new RangeError('Effect memory limit must be a positive whole number of GiB with a safe byte count.');
	}
	return value;
}

/** The desktop preference never increases the browser's processing allowance. */
export function effectPeakMemoryLimitBytes(isDesktop: boolean, configuredGiB?: unknown): number {
	return isDesktop ? normalizeEffectMemoryLimitGiB(configuredGiB) * 1024 ** 3 : BROWSER_EFFECT_PEAK_MEMORY_LIMIT_BYTES;
}
