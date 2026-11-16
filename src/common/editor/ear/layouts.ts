/* SPDX-License-Identifier: AGPL-3.0-only */
import { admBedChannelCount, type AdmBedLayout } from '../adm-bed-layout.ts';

/** The order is also the native ABI's layout selector. */
export const EAR_LAYOUTS = Object.freeze(['stereo', '5.1', '5.1.2', '5.1.4', '7.1', '7.1.4'] as const);
export type EarLayout = typeof EAR_LAYOUTS[number];

export function isEarLayout(value: unknown): value is EarLayout {
	return EAR_LAYOUTS.includes(value as EarLayout);
}

export function earOutputChannelCount(value: unknown): number | null {
	return isEarLayout(value) ? admBedChannelCount(value as AdmBedLayout) : null;
}
