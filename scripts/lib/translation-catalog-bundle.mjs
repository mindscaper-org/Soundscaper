/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { transform } from 'esbuild';

const VIRTUAL_PREFIX = '\0scape:translation-catalog:';
const VIRTUAL_EXTENSION = '.mjs';
const SOURCE_POOL_SPECIFIER = 'scape:translation-source-text';
const SOURCE_POOL_ID = '\0scape:translation-source-text.mjs';
const LOCALE_POOL_SPECIFIER = 'scape:translation-locale-text:';
const MAXIMUM_CATALOG_MODULE_BYTES = 490_000;
const MAXIMUM_LOCALE_TEXT_MODULE_BYTES = 400_000;
const CATALOG_INDEX_SUFFIX = '/src/common/i18n/translations/index.js';
const CATALOG_FIELDS = ['schemaVersion', 'locale', 'provenance', 'entries', 'community'];

/**
 * Keep the committed JSON and its runtime shape intact while sharing repeated
 * string values in the emitted module. Keys remain literal and text stays
 * JSON-escaped; no catalog entry or provenance is removed.
 *
 * @param {Record<string, unknown>} catalog
 * @param {readonly string[]} sourceTexts
 * @param {readonly { specifier: string; texts: readonly string[] }[]} localePools
 */
export function renderTranslationCatalogModule(catalog, sourceTexts = [], localePools = []) {
	const normalized = JSON.parse(JSON.stringify(catalog));
	const counts = new Map();
	countStrings(normalized, counts);
	const shared = new Map(sourceTexts.map((value, index) => [value, `__catalogSourceText[${index}]`]));
	const usesShared = [...counts.keys()].some(value => shared.has(value));
	for (const [poolIndex, pool] of localePools.entries()) {
		for (const [index, text] of pool.texts.entries()) shared.set(text, `__catalogLocaleText_${poolIndex}[${index}]`);
	}
	const strings = new Map([...counts].filter(([value, count]) => !shared.has(value) && count > 1
		&& (['machine', 'audacity', 'human'].includes(value) || new TextEncoder().encode(JSON.stringify(value)).byteLength >= 16))
		.map(([value], index) => [value, `__catalogText_${index}`]));
	return [
		...(usesShared ? [`import __catalogSourceText from ${JSON.stringify(SOURCE_POOL_SPECIFIER)};`] : []),
		...localePools.map((pool, index) => `const __catalogLocaleText_${index} = (await import(${JSON.stringify(pool.specifier)})).default;`),
		...[...strings].map(([value, name]) => `const ${name} = ${JSON.stringify(value)};`),
		`const catalog = ${catalogValue(normalized, new Map([...shared, ...strings]))};`,
		...CATALOG_FIELDS.filter((key) => Object.hasOwn(catalog, key))
			.map((key) => `export const ${key} = catalog.${key};`),
		'export default catalog;',
	].join('\n');
}

/** @param {unknown} value @param {readonly string[]} sourceTexts
 * @param {readonly { specifier: string; texts: readonly string[] }[]} localePools */
function compactCatalogValue(value, sourceTexts = [], localePools = []) {
	const normalized = JSON.parse(JSON.stringify(value));
	const counts = new Map();
	countStrings(normalized, counts);
	const shared = new Map(sourceTexts.map((text, index) => [text, `__catalogSourceText[${index}]`]));
	const usesShared = [...counts.keys()].some(text => shared.has(text));
	for (const [poolIndex, pool] of localePools.entries()) {
		for (const [index, text] of pool.texts.entries()) shared.set(text, `__catalogLocaleText_${poolIndex}[${index}]`);
	}
	const strings = new Map([...counts].filter(([text, count]) => !shared.has(text) && count > 1
		&& (['machine', 'audacity', 'human'].includes(text) || new TextEncoder().encode(JSON.stringify(text)).byteLength >= 16))
		.map(([text], index) => [text, `__catalogText_${index}`]));
	return {
		declarations: [
			...(usesShared ? [`import __catalogSourceText from ${JSON.stringify(SOURCE_POOL_SPECIFIER)};`] : []),
			...localePools.map((pool, index) => `const __catalogLocaleText_${index} = (await import(${JSON.stringify(pool.specifier)})).default;`),
			...[...strings].map(([text, name]) => `const ${name} = ${JSON.stringify(text)};`),
		],
		expression: catalogValue(normalized, new Map([...shared, ...strings])),
	};
}

/** @param {Record<string, unknown>} catalog */
function catalogExports(catalog) {
	return [
		...CATALOG_FIELDS.filter((key) => Object.hasOwn(catalog, key))
			.map((key) => `export const ${key} = catalog.${key};`),
		'export default catalog;',
	];
}

/** @param {string} key */
function isMotionTranslation(key) {
	return key.startsWith('ui.motionscaper.') || key.startsWith('ui.motionscaper-')
		|| key.startsWith('ui.motionLinkBridge.');
}

/** @param {string} key */
function translationOwner(key) {
	if (isMotionTranslation(key)) return 'motion';
	if (/^ui\.framescaper(?:[A-Z.-])/u.test(key)) return 'framescaper';
	return 'core';
}

/** @param {Record<string, unknown>} entries @param {string} owner @param {readonly string[]} sourceTexts
 * @param {readonly { specifier: string; texts: readonly string[] }[]} localePools */
function renderCatalogPart(entries, owner, sourceTexts, localePools) {
	const values = Object.fromEntries(Object.entries(entries)
		.filter(([key]) => translationOwner(key) === owner));
	const { declarations, expression } = compactCatalogValue(values, sourceTexts, localePools);
	return [...declarations, `export default ${expression};`].join('\n');
}

/** Only oversized lazy locales need an additional, independently bounded text module.
 * @param {Record<string, unknown>} catalog
 * @param {readonly string[]} sourceTexts
 * @returns {readonly (readonly string[])[]}
 */
function localeTextPools(catalog, sourceTexts) {
	const counts = new Map();
	countStrings(catalog, counts);
	const shared = new Set(sourceTexts);
	const pools = [];
	let texts = [], bytes = 20;
	for (const text of counts.keys()) {
		const length = new TextEncoder().encode(JSON.stringify(text)).byteLength + 1;
		if (shared.has(text) || length < 16) continue;
		if (bytes + length > MAXIMUM_LOCALE_TEXT_MODULE_BYTES && texts.length) {
			pools.push(texts); texts = []; bytes = 20;
		}
		texts.push(text); bytes += length;
	}
	if (texts.length) pools.push(texts);
	return pools;
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
	/** @type {Map<string, { path: string; source: string }>} */
	const localeTextModules = new Map();
	/** @type {Map<string, { path: string, owner: string }>} */
	const parts = new Map();
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
	/** @param {Record<string, unknown>} catalog @param {readonly string[]} texts @param {string} path
	 * @param {(pools: readonly { specifier: string; texts: readonly string[] }[]) => string} render */
	async function renderBoundedCatalog(catalog, texts, path, render) {
		const source = render([]);
		if (new TextEncoder().encode(source).byteLength < MAXIMUM_CATALOG_MODULE_BYTES) return source;
		const minified = await transform(source, { minify: true, charset: 'utf8' });
		if (new TextEncoder().encode(minified.code).byteLength < MAXIMUM_CATALOG_MODULE_BYTES) return source;
		const pools = localeTextPools(catalog, texts).map((pool, index) => {
			const specifier = `${LOCALE_POOL_SPECIFIER}${basename(path)}:${index}`;
			localeTextModules.set(`\0${specifier}${VIRTUAL_EXTENSION}`, { path, source: `export default ${JSON.stringify(pool)};` });
			return { specifier, texts: pool };
		});
		return render(pools);
	}
	return {
		name: 'scape:compact-translation-catalogs',
		enforce: /** @type {const} */ ('pre'),
		apply: /** @type {const} */ ('build'),
		buildStart() { pendingPool = null; localeTextModules.clear(); parts.clear(); },
		/** @param {string} source @param {string | undefined} importer */
		resolveId(source, importer) {
			if (parts.has(source)) return source;
			if (source === SOURCE_POOL_SPECIFIER) return SOURCE_POOL_ID;
			if (source.startsWith(LOCALE_POOL_SPECIFIER)) {
				const id = `\0${source}${VIRTUAL_EXTENSION}`;
				return localeTextModules.has(id) ? id : null;
			}
			if (!importer?.replaceAll('\\', '/').endsWith(CATALOG_INDEX_SUFFIX)
				|| !/^\.\/[^/\\]+\.json$/u.test(source)) return null;
			catalogDirectory = dirname(importer);
			return `${VIRTUAL_PREFIX}${resolve(catalogDirectory, source)}${VIRTUAL_EXTENSION}`;
		},
		/** @this {{ addWatchFile(path: string): void }} @param {string} id */
		async load(id) {
			const localeText = localeTextModules.get(id);
			if (localeText) { this.addWatchFile(localeText.path); return localeText.source; }
			if (id === SOURCE_POOL_ID) {
				const pool = await loadPool();
				for (const path of pool.paths) this.addWatchFile(path);
				return `export default ${JSON.stringify(pool.texts)};`;
			}
			if (!id.startsWith(VIRTUAL_PREFIX)) return null;
			const part = parts.get(id);
			if (part) {
				this.addWatchFile(part.path);
				const catalog = JSON.parse(await readFile(part.path, 'utf8'));
				const { texts } = await loadPool();
				const values = Object.fromEntries(Object.entries(catalog.entries).filter(([key]) => translationOwner(key) === part.owner));
				return renderBoundedCatalog(values, texts, `${part.path}.${part.owner}`,
					pools => renderCatalogPart(values, part.owner, texts, pools));
			}
			const path = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_EXTENSION.length);
			this.addWatchFile(path);
			const catalog = JSON.parse(await readFile(path, 'utf8'));
			if (Object.keys(catalog.entries).some(isMotionTranslation)) {
				const imports = [];
				for (const owner of ['core', 'motion', 'framescaper']) {
					const partId = `${VIRTUAL_PREFIX}${path}.${owner}${VIRTUAL_EXTENSION}`;
					parts.set(partId, { path, owner });
					imports.push(`import(${JSON.stringify(partId)})`);
				}
				const { declarations, expression } = compactCatalogValue({ ...catalog, entries: undefined });
				return [
					// The selected locale awaits its fragments. Static imports here would
					// put every locale's fragment URLs in the initial Vite preload list.
					`const [core, motion, framescaper] = await Promise.all([${imports.join(', ')}]);`,
					...declarations,
					`const catalog = { ...${expression}, entries: { ...core.default, ...motion.default, ...framescaper.default } };`,
					...catalogExports(catalog),
				].join('\n');
			}
			const { texts } = await loadPool();
			return renderBoundedCatalog(catalog, texts, path, pools => renderTranslationCatalogModule(catalog, texts, pools));
		},
		/** @param {import('rolldown').OutputOptions} options */
		outputOptions(options) {
			if (options.codeSplitting === false) return null;
			const splitting = typeof options.codeSplitting === 'object' ? options.codeSplitting : {};
			return { ...options, codeSplitting: {
				...splitting,
				groups: [
					...(splitting.groups ?? []),
					{
						// Output options run before loading the graph; resolve registered
						// virtual owners when the bundler assigns each module to a chunk.
						/** @param {string} id */
						name(id) {
							const part = parts.get(id);
							return part ? `translation-${basename(part.path, '.json')}-${part.owner}` : null;
						},
						priority: 200, minSize: 0, includeDependenciesRecursively: false,
					},
				],
			} };
		},
	};
}
