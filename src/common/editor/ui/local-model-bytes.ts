/* SPDX-License-Identifier: AGPL-3.0-only */

const formatters = new Map<string, Intl.NumberFormat>();

export function formatLocalModelBytes(value: number | null, locale = 'en'): string | null {
	if (value === null) return null;
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	let amount = value;
	let unitIndex = 0;
	while (amount >= 1024 && unitIndex < units.length - 1) {
		amount /= 1024;
		unitIndex += 1;
	}
	const maximumFractionDigits = unitIndex === 0 ? 0 : 1;
	const key = `${locale}:${maximumFractionDigits}`;
	let formatter = formatters.get(key);
	if (!formatter) {
		formatter = new Intl.NumberFormat(locale, { maximumFractionDigits });
		if (formatters.size >= 32) formatters.delete(formatters.keys().next().value!);
		formatters.set(key, formatter);
	}
	return `${formatter.format(amount)} ${units[unitIndex]}`;
}
