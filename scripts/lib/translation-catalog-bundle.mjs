/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const VIRTUAL_PREFIX = '\0scape:translation-catalog:';
const VIRTUAL_EXTENSION = '.mjs';
const SOURCE_POOL_SPECIFIER = 'scape:translation-source-text';
const SOURCE_POOL_ID = '\0scape:translation-source-text.mjs';
const CATALOG_INDEX_SUFFIX = '/src/common/i18n/translations/index.js';
const CATALOG_FIELDS = ['schemaVersion', 'locale', 'provenance', 'entries', 'community'];

/**
 * Keep the committed JSON and its runtime shape intact while sharing repeated
 * string values in the emitted module. Keys remain literal and text stays
 * JSON-escaped; no catalog entry or provenance is removed.
 *
 * @param {Record<string, unknown>} catalog
 * @param {readonly string[]} sourceTexts
 */
export function renderTranslationCatalogModule(catalog, sourceTexts = []) {
	const normalized = JSON.parse(JSON.stringify(catalog));
	const counts = new Map();
	countStrings(normalized, counts);
	const shared = new Map(sourceTexts.map((value, index) => [value, `__catalogSourceText[${index}]`]));
	const usesShared = [...counts.keys()].some(value => shared.has(value));
	const strings = new Map([...counts].filter(([value, count]) => !shared.has(value) && count > 1
		&& (['machine', 'audacity', 'human'].includes(value) || new TextEncoder().encode(JSON.stringify(value)).byteLength >= 16))
		.map(([value], index) => [value, `__catalogText_${index}`]));
	return [
		...(usesShared ? [`import __catalogSourceText from ${JSON.stringify(SOURCE_POOL_SPECIFIER)};`] : []),
		...[...strings].map(([value, name]) => `const ${name} = ${JSON.stringify(value)};`),
		`const catalog = ${catalogValue(normalized, new Map([...shared, ...strings]))};`,
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

/** English recorded in several locales is shared without changing any catalog tuple.
 * @param {readonly Record<string, unknown>[]} catalogs
 * @returns {readonly string[]}
 */
export function translationCatalogSourceTexts(catalogs) {
	const counts = new Map();
	for (const catalog of catalogs) {
		const sources = new Set(Object.values(catalog.entries ?? {}).filter(Array.isArray)
			.map(entry => entry[1]).filter(source => typeof source === 'string'));
		for (const source of sources) counts.set(source, (counts.get(source) ?? 0) + 1);
	}
	return Object.freeze([...counts].filter(([source, count]) => count > 1
		&& new TextEncoder().encode(JSON.stringify(source)).byteLength >= 16)
		.map(([source]) => source).sort());
}

/** Substitute only the generated index's lazy catalog imports during builds. */
export function createTranslationCatalogBundlePlugin() {
	let catalogDirectory = '';
	/** @type {Promise<{ paths: string[], texts: readonly string[] }> | null} */
	let pendingPool = null;
	async function loadPool() {
		pendingPool ??= (async () => {
			const paths = (await readdir(catalogDirectory)).filter(name => name.endsWith('.json')).sort()
				.map(name => join(catalogDirectory, name));
			const catalogs = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8'))));
			return { paths, texts: translationCatalogSourceTexts(catalogs) };
		})();
		return pendingPool;
	}
	return {
		name: 'scape:compact-translation-catalogs',
		enforce: /** @type {const} */ ('pre'),
		apply: /** @type {const} */ ('build'),
		buildStart() { pendingPool = null; },
		/** @param {string} source @param {string | undefined} importer */
		resolveId(source, importer) {
			if (source === SOURCE_POOL_SPECIFIER) return SOURCE_POOL_ID;
			if (!importer?.replaceAll('\\', '/').endsWith(CATALOG_INDEX_SUFFIX)
				|| !/^\.\/[^/\\]+\.json$/u.test(source)) return null;
			catalogDirectory = dirname(importer);
			return `${VIRTUAL_PREFIX}${resolve(catalogDirectory, source)}${VIRTUAL_EXTENSION}`;
		},
		/** @this {{ addWatchFile(path: string): void }} @param {string} id */
		async load(id) {
			if (id === SOURCE_POOL_ID) {
				const pool = await loadPool();
				for (const path of pool.paths) this.addWatchFile(path);
				return `export default ${JSON.stringify(pool.texts)};`;
			}
			if (!id.startsWith(VIRTUAL_PREFIX)) return null;
			const path = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_EXTENSION.length);
			this.addWatchFile(path);
			return renderTranslationCatalogModule(JSON.parse(await readFile(path, 'utf8')), (await loadPool()).texts);
		},
	};
}
