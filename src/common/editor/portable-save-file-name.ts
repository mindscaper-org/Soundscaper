/* SPDX-License-Identifier: AGPL-3.0-only */

import { fitExportFileName } from './export-name-byte-budget.ts';

/** Windows reserves these stems even when a normal extension follows them. */
export function escapeReservedFileName(value: string): string {
	return /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(value) ? `_${value}` : value;
}

/** Retain the output suffix while making authored names portable on disk. */
export function sanitizeSuggestedFileName(value: unknown): string {
	const name = escapeReservedFileName(String(value || 'soundscaper-export')
		// eslint-disable-next-line no-control-regex -- Control bytes cannot occur in a portable filename.
		.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, '-').replace(/[. ]+$/gu, '')
		|| 'soundscaper-export');
	const suffix = /\.[a-z0-9]{1,16}$/iu.exec(name)?.[0] ?? '';
	return fitExportFileName(suffix ? name.slice(0, -suffix.length) : name, '', suffix).replace(/[. ]+$/gu, '');
}
