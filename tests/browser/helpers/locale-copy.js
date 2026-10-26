/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';

import { ENGLISH_COPY } from '../../../src/common/i18n/catalogs.js';
import { currentTranslations } from '../../../src/common/i18n/translation-catalog.js';

const cache = new Map();

/**
 * The copy a locale resolves to, composed the way the runtime composes it:
 * English and the locale's committed
 * translation catalog on top — machine, Audacity and hand-written entries in
 * one file. Reading the file directly keeps a spec truthful about what the
 * page actually shows, whether or not a locale has been generated yet.
 */
export function localeCopy(locale) {
	if (!cache.has(locale)) {
		let entries = {};
		try {
			const catalog = JSON.parse(readFileSync(new URL(`../../../src/common/i18n/translations/${locale}.json`, import.meta.url), 'utf8'));
			entries = currentTranslations(catalog, ENGLISH_COPY, { locale });
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
		cache.set(locale, Object.freeze({ ...ENGLISH_COPY, ...entries }));
	}
	return cache.get(locale);
}
