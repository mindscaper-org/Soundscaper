/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, type createDeliveryReport } from './delivery-report.ts';
import { isHexColor } from './dawproject-format.ts';

/** Canonical 600 swatches from the pinned Audacity design tokens, not a theme snapshot. */
export const DAWPROJECT_PALETTE_COLORS: Readonly<Record<string, string>> = Object.freeze({
	blue: '#66A3FF', violet: '#9996FC', magenta: '#DA8CCC', red: '#F08080', orange: '#FF9E65',
	yellow: '#E8C050', green: '#74BE59', teal: '#34B494', cyan: '#48BECF',
});
const paletteNames = new Map(Object.entries(DAWPROJECT_PALETTE_COLORS).map(([name, rgb]) => [rgb.toLowerCase(), name]));

export function dawprojectExportColor(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	return Object.hasOwn(DAWPROJECT_PALETTE_COLORS, value) ? DAWPROJECT_PALETTE_COLORS[value]! : isHexColor(value) ? value : null;
}

/** Preserve supported palette identity; arbitrary RGB has no native picker value. */
export function dawprojectImportColor(value: string | null | undefined,
	draft: ReturnType<typeof createDeliveryReport>, scope: Readonly<Record<string, unknown>>): string | undefined {
	if (!value) return undefined;
	const name = paletteNames.get(value.toLowerCase());
	if (name) return name;
	addDeliveryReportItem(draft, { code: 'dawproject.color-omitted', disposition: 'omitted', severity: 'warning', scope,
		data: { color: value }, message: 'The authored RGB color is outside the native palette and was omitted.' });
	return undefined;
}
