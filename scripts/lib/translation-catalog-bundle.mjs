/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const VIRTUAL_PREFIX = '\0scape:translation-catalog:';
const VIRTUAL_EXTENSION = '.mjs';
const CATALOG_INDEX_SUFFIX = '/src/common/i18n/translations/index.js';
const CATALOG_FIELDS = ['schemaVersion', 'locale', 'provenance', 'entries', 'community'];

/**
 * Keep the committed JSON and its runtime shape intact while sharing repeated
 * string values in the emitted module. Keys remain literal and text stays
 * JSON-escaped; no catalog entry or provenance is removed.
 *
 * @param {Record<string, unknown>} catalog
 */
export function renderTranslationCatalogModule(catalog) {
	const normalized = JSON.parse(JSON.stringify(catalog));
	const counts = new Map();
	countStrings(normalized, counts);
	const strings = new Map([...counts].filter(([value, count]) => count > 1
		&& (['machine', 'audacity', 'human'].includes(value) || new TextEncoder().encode(JSON.stringify(value)).byteLength >= 16))
		.map(([value], index) => [value, `__catalogText_${index}`]));
	return [
		...[...strings].map(([value, name]) => `const ${name} = ${JSON.stringify(value)};`),
		`const catalog = ${catalogValue(normalized, strings)};`,
		...CATALOG_FIELDS.filter((key) => Object.hasOwn(catalog, key))
			.map((key) => `export const ${key} = catalog.${key};`),
		'export default catalog;',
	].join('\n');
}

/** @param {unknown} value @param {Map<string, number>} counts */
function countStrings(value, counts) {
	if (typeof value === 'string') counts.set(value, (counts.get(value) ?? 0) + 1);
	else if (Array.isArray(value)) for (const item of value) countStrings(item, counts);
	else if (value && typeof value === 'object') for (const item of Object.values(value)) countStrings(item, counts);
}

/** @param {unknown} value @param {ReadonlyMap<string, string>} strings @returns {string} */
function catalogValue(value, strings) {
	if (typeof value === 'string') return strings.get(value) ?? JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(item => catalogValue(item, strings)).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => (
		`${key === '__proto__' ? '["__proto__"]' : JSON.stringify(key)}:${catalogValue(item, strings)}`
	)).join(',')}}`;
	return JSON.stringify(value) ?? 'null';
}

/** Substitute only the generated index's lazy catalog imports during builds. */
export function createTranslationCatalogBundlePlugin() {
	return {
		name: 'scape:compact-translation-catalogs',
		enforce: /** @type {const} */ ('pre'),
		apply: /** @type {const} */ ('build'),
		/** @param {string} source @param {string | undefined} importer */
		resolveId(source, importer) {
			if (!importer?.replaceAll('\\', '/').endsWith(CATALOG_INDEX_SUFFIX)
				|| !/^\.\/[^/\\]+\.json$/u.test(source)) return null;
			return `${VIRTUAL_PREFIX}${resolve(dirname(importer), source)}${VIRTUAL_EXTENSION}`;
		},
		/** @this {{ addWatchFile(path: string): void }} @param {string} id */
		async load(id) {
			if (!id.startsWith(VIRTUAL_PREFIX)) return null;
			const path = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_EXTENSION.length);
			this.addWatchFile(path);
			return renderTranslationCatalogModule(JSON.parse(await readFile(path, 'utf8')));
		},
	};
}
