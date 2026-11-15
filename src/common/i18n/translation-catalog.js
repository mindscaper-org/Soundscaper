/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The committed translation catalogs: one JSON file per locale under
 * `./translations/`, every entry tagged with where it came from.
 *
 *   ["machine",  "<English at translation time>", "<translation>"]
 *   ["audacity", "<English at sync time>",        "<reviewed string>"]
 *   ["human",    "<English when written>",        "<hand-written string>"]
 *
 * The tag says who may overwrite the entry: the weekly Audacity sync and the
 * machine translator replace `machine` and `audacity` entries, and never
 * touch a `human` one. The recorded English says whether the entry still
 * applies: an entry of any origin is shown only while its English is the
 * current English, so editing copy retires its translations on its own until
 * the sync or the translator writes them again. At runtime a catalog is
 * lazy-imported and laid over the bundled English copy.
 *
 * This module deliberately imports no catalog: the site shell reads it in the
 * initial graph and passes the small site copy as its English reference, and
 * the editor runtime passes the complete English catalog.
 */

import { normalizeBcp47Locale } from './locale.js';
import { currentTranslations } from './translation-catalog-validation.ts';
import { TRANSLATION_CATALOG_LOADERS } from './translations/index.js';

export {
	TRANSLATION_CATALOG_SCHEMA_VERSION, TRANSLATION_ORIGINS, AUTOMATIC_ORIGINS,
	currentTranslations, acceptableTranslation, namedPlaceholders, sameNamedPlaceholders, protectedTokens,
} from './translation-catalog-validation.ts';

/** The catalog locale that serves `locale`: its exact canonical tag, or null. */
export function translationCatalogLocale(locale, loaders = TRANSLATION_CATALOG_LOADERS) {
	const normalized = normalizeBcp47Locale(locale);
	return Object.hasOwn(loaders, normalized) ? normalized : null;
}

/**
 * Load the strings for `locale` that are current against `englishCopy`, or
 * null when no catalog serves the locale. Load failures propagate; the caller
 * decides what a missing chunk means.
 */
export async function loadTranslationCatalog(locale, options = {}) {
	const loaders = options.loaders || TRANSLATION_CATALOG_LOADERS;
	const catalogLocale = translationCatalogLocale(locale, loaders);
	if (!catalogLocale) return null;
	const module = await loaders[catalogLocale]();
	const catalog = module && typeof module === 'object' && 'default' in module ? module.default : module;
	return currentTranslations(catalog, options.englishCopy, { locale: catalogLocale });
}
