/* SPDX-License-Identifier: AGPL-3.0-only */

/** Delay's selection-only duration choice joins statically declared transforms. */
export function selectionEffectChangesLength(
	type: string, params: Readonly<Record<string, unknown>>, definition?: Readonly<{ lengthChanging?: boolean }>,
): boolean {
	return Boolean(definition?.lengthChanging)
		|| type === 'multi-tap-delay' && params.duration === 'extend' && Number(params.mix) > 0;
}
