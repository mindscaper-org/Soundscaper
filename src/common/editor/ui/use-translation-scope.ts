/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useState } from 'react';
import { normalizeBcp47Locale } from '../../i18n/locale.js';
import { loadTranslationCatalog } from '../../i18n/translation-catalog.js';
import { resolveEditorCopyScope } from '../../i18n/editor-copy-scope.ts';

type ScopeLoader = (locale: string, options: Readonly<{ englishCopy: Readonly<Record<string, string>> }>) => Promise<Readonly<Record<string, string>> | null>;

/** Optional surfaces validate their own English without adding it to the startup inventory. */
export function useTranslationScope<Catalog extends Readonly<Record<string, string>>>(
	owner: string, defaults: Catalog, candidate: unknown, publishedCopy: Readonly<Record<string, unknown>>,
	loadCatalog: ScopeLoader = loadTranslationCatalog,
): Readonly<Catalog> {
	const locale = normalizeBcp47Locale(typeof candidate === 'string' ? candidate : 'en');
	const englishCopy = useMemo(() => Object.fromEntries(Object.entries(defaults)
		.map(([key, source]) => [`ui.${owner}.${key}`, source])), [defaults, owner]);
	const [loaded, setLoaded] = useState<{
		locale: string;
		reference: typeof englishCopy;
		entries: Readonly<Record<string, string>>;
	} | null>(null);
	useEffect(() => {
		if (locale === 'en') return;
		let active = true;
		void loadCatalog(locale, { englishCopy }).then(entries => {
			if (active) setLoaded({ locale, reference: englishCopy, entries: entries ?? {} });
		}).catch(() => {
			// English and published preview copy remain available when a chunk is unavailable.
		});
		return () => { active = false; };
	}, [locale, englishCopy, loadCatalog]);
	return useMemo(() => resolveEditorCopyScope(owner, defaults, {
		...(loaded?.locale === locale && loaded.reference === englishCopy ? loaded.entries : {}),
		...publishedCopy,
	}), [defaults, englishCopy, loaded, locale, owner, publishedCopy]);
}
