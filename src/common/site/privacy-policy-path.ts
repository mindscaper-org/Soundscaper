/* SPDX-License-Identifier: AGPL-3.0-only */

import { localeLanguage } from '../i18n/locale.js';

/** Policy editions are independent of the language coverage of the editors. */
export function privacyPolicyLocale(locale = 'en'): 'de' | 'en' {
	return localeLanguage(locale) === 'de' ? 'de' : 'en';
}

export function privacyPolicyPath(locale = 'en'): string {
	return `/privacy/${privacyPolicyLocale(locale)}/`;
}
