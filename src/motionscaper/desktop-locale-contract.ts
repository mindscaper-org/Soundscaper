/* SPDX-License-Identifier: AGPL-3.0-only */
import { COMMITTED_LOCALE_TAGS } from '../common/i18n/locales.js';
export interface MotionDesktopLocale { set(locale: string): Promise<string> }
/** Only maintained, committed catalogs may be selected through the private bridge. */
export function validateMotionDesktopLocale(value: unknown): string {
	if (typeof value !== 'string' || value.length > 32) throw new TypeError('Invalid Motionscaper locale.');
	const locale = COMMITTED_LOCALE_TAGS.find(candidate => candidate.toLowerCase() === value.toLowerCase());
	if (!locale) throw new RangeError('Unsupported Motionscaper locale.');
	return locale;
}
/** Match the maintained desktop preference order without treating malformed input as English. */
export function resolveMotionDesktopLocale(candidates: readonly unknown[]): string {
	for (const value of candidates) {
		if (typeof value !== 'string') continue;
		let canonical: string | undefined;
		try { canonical = Intl.getCanonicalLocales(value.trim().replaceAll('_', '-'))[0]; } catch { continue; }
		if (!canonical) continue;
		const normalized = canonical.toLowerCase();
		const exact = COMMITTED_LOCALE_TAGS.find(locale => locale.toLowerCase() === normalized);
		const language = (canonical.split('-')[0] ?? '').toLowerCase();
		const matched = exact ?? COMMITTED_LOCALE_TAGS.find(locale => (locale.split('-')[0] ?? '').toLowerCase() === language);
		if (matched) return matched;
	}
	return 'en';
}
