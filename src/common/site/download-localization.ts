/* SPDX-License-Identifier: AGPL-3.0-only */

import { ROUTE_LOCALES } from '../i18n/locales.js';
import { currentTranslations } from '../i18n/translation-catalog-validation.ts';
import { DOWNLOAD_ENGLISH_COPY, type DownloadCopy } from './download-copy.ts';
import { TRANSLATION_CATALOG_LOADERS } from './download-translations/index.js';

export interface DownloadLocaleDescriptor {
	readonly locale: string;
	readonly nativeName: string;
	readonly direction: 'ltr' | 'rtl';
}

export const DOWNLOAD_LOCALES: readonly DownloadLocaleDescriptor[] = ROUTE_LOCALES;

export function downloadLocaleForPath(pathname: string): DownloadLocaleDescriptor | null {
	const match = /^\/download(?:\/([A-Za-z]+(?:-[A-Za-z]+)*))?\/?$/u.exec(pathname);
	if (!match) return null;
	const tag = (match[1] ?? 'en').toLowerCase();
	return DOWNLOAD_LOCALES.find(descriptor => descriptor.locale.toLowerCase() === tag) ?? null;
}

/** Keep page catalogs separate so the Worker never bundles the full editor translations. */
export async function downloadCopyForLocale(locale: string): Promise<DownloadCopy> {
	if (locale === 'en' || locale === 'en-GB') return DOWNLOAD_ENGLISH_COPY;
	const loaders: Readonly<Record<string, () => Promise<{ default: unknown }>>> = TRANSLATION_CATALOG_LOADERS;
	const loader = loaders[locale];
	if (!loader) return DOWNLOAD_ENGLISH_COPY;
	const { default: catalog } = await loader();
	return { ...DOWNLOAD_ENGLISH_COPY, ...currentTranslations(catalog, DOWNLOAD_ENGLISH_COPY, { locale }) };
}
