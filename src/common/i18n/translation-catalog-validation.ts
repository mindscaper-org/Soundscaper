/* SPDX-License-Identifier: AGPL-3.0-only */

// Pure catalog validation: safe to use in standalone Workers without editor loaders.
import { normalizeBcp47Locale } from './locale.js';

export const TRANSLATION_CATALOG_SCHEMA_VERSION = 2;
export const TRANSLATION_ORIGINS: readonly string[] = Object.freeze(['machine', 'audacity', 'human']);
/** Origins an automatic writer may replace; a human entry is never one of them. */
export const AUTOMATIC_ORIGINS: readonly string[] = Object.freeze(['machine', 'audacity']);

const ELLIPSIS_PATTERN = /…|\.\.\./u;
const NAMED_PLACEHOLDER_PATTERN = /\{[A-Za-z][A-Za-z0-9_]*\}/gu;
// Tokens a translation has to carry through unchanged: `*track*`-style
// identifiers and file extensions such as `.aup4`.
const PROTECTED_TOKEN_PATTERN = /\*[A-Za-z][A-Za-z0-9_-]*\*|(?<![A-Za-z0-9])\.[a-z][a-z0-9]{1,5}\b/giu;

interface TranslationCatalog {
	readonly schemaVersion: number;
	readonly locale: string;
	readonly entries: Readonly<Record<string, unknown>>;
}

interface TranslationOptions {
	readonly locale?: string;
	readonly origins?: unknown;
}

/**
 * The entries of `catalog` that may be shown against `englishCopy`: the key
 * still exists, the recorded English is the current English, and the string
 * is acceptable for it. Anything else is left out. `options.origins` narrows
 * the result to some origins, which the site copy and the tests use.
 */
export function currentTranslations(
	catalog: unknown,
	englishCopy: Readonly<Record<string, string>>,
	options: TranslationOptions = {},
): Readonly<Record<string, string>> {
	assertTranslationCatalogShape(catalog, options.locale);
	if (!englishCopy || typeof englishCopy !== 'object') throw new TypeError('Translation catalog entries need an English reference.');
	const origins = admittedTranslationOrigins(options.origins);
	const entries: Record<string, string> = {};
	for (const [key, entry] of Object.entries(catalog.entries)) {
		if (!Object.hasOwn(englishCopy, key) || !Array.isArray(entry) || entry.length !== 3) continue;
		const [origin, source, translation] = entry;
		if (!TRANSLATION_ORIGINS.includes(origin) || (origins && !origins.has(origin))) continue;
		if (source !== englishCopy[key] || !acceptableTranslation(source, translation)) continue;
		entries[key] = translation;
	}
	return Object.freeze(entries);
}

/**
 * Whether `translation` may stand in for `source`: a trimmed non-empty string
 * without ellipses that keeps the English's named placeholders, line count,
 * identifiers and file extensions.
 */
export function acceptableTranslation(source: unknown, translation: unknown): translation is string {
	if (typeof source !== 'string' || typeof translation !== 'string') return false;
	if (!translation.trim() || translation !== translation.trim()) return false;
	if (ELLIPSIS_PATTERN.test(translation)) return false;
	if (translation.includes('<docs-ai-token')) return false;
	if (lineCount(source) !== lineCount(translation)) return false;
	if (!sameNamedPlaceholders(source, translation)) return false;
	const sourceTokens = protectedTokenOccurrences(source);
	const translationTokens = protectedTokenOccurrences(translation);
	const sourceIdentifiers = sourceTokens.filter((token) => token.startsWith('*'));
	const translationIdentifiers = translationTokens.filter((token) => token.startsWith('*'));
	if (!sameTokenOccurrences(sourceIdentifiers, translationIdentifiers)) return false;
	return containsTokenOccurrences(
		translationTokens.filter((token) => !token.startsWith('*')),
		sourceTokens.filter((token) => !token.startsWith('*')),
	);
}

export function namedPlaceholders(value: unknown): string[] {
	return [...String(value).matchAll(NAMED_PLACEHOLDER_PATTERN)].map(([placeholder]) => placeholder).sort();
}

export function sameNamedPlaceholders(source: unknown, translation: unknown): boolean {
	const left = namedPlaceholders(source);
	const right = namedPlaceholders(translation);
	return left.length === right.length && left.every((placeholder, index) => placeholder === right[index]);
}

export function protectedTokens(value: unknown): string[] {
	return [...new Set([...String(value).matchAll(PROTECTED_TOKEN_PATTERN)].map(([token]) => token))];
}

function protectedTokenOccurrences(value: string): string[] {
	return [...String(value).matchAll(PROTECTED_TOKEN_PATTERN)].map(([token]) => token).sort();
}

function sameTokenOccurrences(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((token, index) => token === right[index]);
}

function containsTokenOccurrences(available: readonly string[], required: readonly string[]): boolean {
	const remaining = [...available];
	return required.every((token) => {
		const index = remaining.indexOf(token);
		if (index < 0) return false;
		remaining.splice(index, 1);
		return true;
	});
}

function admittedTranslationOrigins(value: unknown): ReadonlySet<unknown> | null {
	if (value === undefined || value === null) return null;
	if (!Array.isArray(value) || value.some((origin) => !TRANSLATION_ORIGINS.includes(origin))) {
		throw new TypeError('Translation catalog origins must be an array of recognized origins.');
	}
	return new Set(value);
}

function lineCount(value: string): number {
	return value.split('\n').length;
}

function assertTranslationCatalogShape(catalog: unknown, locale?: string): asserts catalog is TranslationCatalog {
	if (!isRecord(catalog)) throw new Error('Translation catalog must be an object.');
	if (catalog.schemaVersion !== TRANSLATION_CATALOG_SCHEMA_VERSION) throw new Error('Unsupported translation catalog schema.');
	if (typeof catalog.locale !== 'string' || normalizeBcp47Locale(catalog.locale) !== catalog.locale) {
		throw new Error('Translation catalog locale is not canonical.');
	}
	if (locale && catalog.locale !== locale) throw new Error(`Translation catalog locale ${catalog.locale} does not match ${locale}.`);
	if (!isRecord(catalog.entries)) {
		throw new Error('Translation catalog entries must be an object.');
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
