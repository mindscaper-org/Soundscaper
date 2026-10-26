/* SPDX-License-Identifier: AGPL-3.0-only */
import { REPORT_ITEM_COPY } from '../../../i18n/editor-report-item-copy.ts';
import { formatLocalizedTemplate } from '../localization-template.ts';
export function reportItemLabel(value: unknown, copy: Readonly<Record<string, string | undefined>> = {}): string {
	const item = value && typeof value === 'object' ? value as Readonly<Record<string, unknown>> : {};
	const key = `reportItem.${String(item.code ?? '')}`;
	const fallback = Object.hasOwn(REPORT_ITEM_COPY, key) ? REPORT_ITEM_COPY[key]! : REPORT_ITEM_COPY.reportItemUnknown!;
	if (item.code === 'MISSING_LOCAL_AUDIO') {
		const data = item.data && typeof item.data === 'object' ? item.data as Readonly<Record<string, unknown>> : {};
		if (typeof data.name === 'string' && data.name) return formatLocalizedTemplate(copy.reportItemMissingAudio || REPORT_ITEM_COPY.reportItemMissingAudio!, { name: data.name });
	}
	return copy[key] || (Object.hasOwn(REPORT_ITEM_COPY, key) ? fallback : copy.reportItemUnknown || fallback);
}
