/* SPDX-License-Identifier: AGPL-3.0-only */

import english from './catalogs/en.json' with { type: 'json' };
import { TRANSLATION_CATALOG_LOADERS } from './catalogs/index.js';
import languages from './languages.json' with { type: 'json' };

export interface AudacityDownloadCatalog {
	readonly nativeName: string;
	readonly direction: string;
	readonly description: string;
	readonly copy: Readonly<Record<keyof typeof english.copy, string>>;
	readonly comparison: Readonly<Record<string, string>>;
}

export const AUDACITY_DOWNLOAD_LANGUAGES = languages.map(({ locale }) => locale);
export const AUDACITY_DOWNLOAD_LOCALES = languages;

export function audacityDownloadLocale(pathname: string): string | null {
	const match = /^\/download\/audacity(?:\/([A-Za-z]+(?:-[A-Za-z]+)*))?\/?$/u.exec(pathname);
	return match ? AUDACITY_DOWNLOAD_LANGUAGES.find(locale => locale.toLowerCase() === (match[1] ?? 'en').toLowerCase()) ?? null : null;
}

export async function audacityDownloadCatalog(locale: string): Promise<AudacityDownloadCatalog> {
	const loaders: Readonly<Record<string, () => Promise<{ default: AudacityDownloadCatalog }>>> = TRANSLATION_CATALOG_LOADERS;
	return (await loaders[locale]()).default;
}
