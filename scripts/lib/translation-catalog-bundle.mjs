/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { transformSync } from 'esbuild';
import {
	assembleTranslationCatalogModule,
	partitionTranslationCatalog,
	translationCatalogPartId,
	TRANSLATION_CATALOG_PART_PREFIX,
} from './translation-catalog-partition.mjs';

const VIRTUAL_PREFIX = '\0scape:translation-catalog:';
const VIRTUAL_EXTENSION = '.mjs';
const SOURCE_POOL_SPECIFIER = 'scape:translation-source-text';
const SOURCE_POOL_ID = '\0scape:translation-source-text.mjs';
const LOCALE_POOL_SPECIFIER = 'scape:translation-locale-text:';
const MAXIMUM_CATALOG_MODULE_BYTES = 490_000;
const MAXIMUM_LOCALE_TEXT_MODULE_BYTES = 400_000;
const LOCALE_TEXT_COMPILER_RESERVE_BYTES = 1_024;
const CATALOG_INDEX_SUFFIX = '/src/common/i18n/translations/index.js';
const CATALOG_FIELDS = ['schemaVersion', 'locale', 'provenance', 'entries', 'community'];
const TUPLE_FACTORY = 'const $e=(o,r)=>Array.from({length:r.length/3},(_,i)=>[r[i*3],[o,r[i*3+1],r[i*3+2]]]);';
/** @typedef {{ origin: string, rows: [string, string, string][] }} OriginRun */
/** @typedef {{ entries: object, runs: OriginRun[] }} OriginTable */

/**
 * Keep the committed JSON and its runtime shape intact. Repeated string values
 * share a literal only when their declarations and references save bytes.
 * The JSON snapshot preserves serialization semantics; keys are never interned.
 *
 * @param {Record<string, unknown>} catalog
 * @param {readonly string[]} sourceTexts
 * @param {readonly { specifier: string; texts: readonly string[] }[]} localePools
 */
export function renderTranslationCatalogModule(catalog, sourceTexts = [], localePools = []) {
	const snapshot = /** @type {unknown} */ (JSON.parse(JSON.stringify(catalog)));
	const baseline = renderModule(snapshot, catalog, null, sourceTexts, localePools), table = originTable(snapshot);
	if (!table) return baseline;
	const candidate = renderModule(snapshot, catalog, table, sourceTexts, localePools);
	// Charge the complete factory, table calls, literals, declarations and exports.
	if (Buffer.byteLength(candidate) >= Buffer.byteLength(baseline)) return baseline;
	// Array-table keys stay quoted; object keys and reference names may shrink.
	// Compare actual standalone minification too, rather than estimating that loss.
	const options = { minify: true, charset: /** @type {const} */ ('utf8') };
	return Buffer.byteLength(transformSync(candidate, options).code) < Buffer.byteLength(transformSync(baseline, options).code)
		? candidate : baseline;
}

/** @param {unknown} snapshot @param {Record<string, unknown>} catalog @param {OriginTable | null} table
 * @param {readonly string[]} sourceTexts
 * @param {readonly { specifier: string; texts: readonly string[] }[]} localePools
 */
function renderModule(snapshot, catalog, table, sourceTexts, localePools) {
	/** @type {Map<string, number>} */
	const counts = new Map();
	countStrings(snapshot, counts, table);
	/** @type {Map<string, string>} */
	const references = new Map(sourceTexts.map((value, index) => [value, `__catalogSourceText[${index}]`]));
	for (const [poolIndex, pool] of localePools.entries()) {
		for (const [index, value] of pool.texts.entries()) references.set(value, `__catalogLocaleText_${poolIndex}[${index}]`);
	}
	const declarations = [];
	for (const [value, count] of counts) {
		if (count < 2 || references.has(value)) continue;
		const literal = JSON.stringify(value);
		const reference = `$t${declarations.length}`;
		const declaration = `const ${reference}=${literal};`;
		const literalBytes = Buffer.byteLength(literal);
		// Charge the exact emitted declaration, its separating newline, and every
		// ASCII reference. Even a small positive saving pays its complete source cost.
		const saving = count * literalBytes - Buffer.byteLength(`${declaration}\n`) - count * reference.length;
		if (saving <= 0) continue;
		references.set(value, reference);
		declarations.push(declaration);
	}
	const source = renderJsonValue(snapshot, references, table);
	const used = new Set([...counts.keys()].map(value => references.get(value)));
	return [
		...([...used].some(value => value?.startsWith('__catalogSourceText['))
			? [`import __catalogSourceText from ${JSON.stringify(SOURCE_POOL_SPECIFIER)};`] : []),
		...localePools.flatMap((pool, index) => [...used].some(value => value?.startsWith(`__catalogLocaleText_${index}[`))
			? [`const __catalogLocaleText_${index} = (await import(${JSON.stringify(pool.specifier)})).default;`] : []),
		...declarations,
		...(table ? [TUPLE_FACTORY] : []),
		`const catalog = ${source};`,
		...CATALOG_FIELDS.filter((key) => Object.hasOwn(catalog, key))
			.map((key) => `export const ${key} = catalog.${key};`),
		'export default catalog;',
	].join('\n');
}

/** @param {unknown} snapshot @returns {OriginTable | null} */
function originTable(snapshot) {
	if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
	const entries = /** @type {Record<string, unknown>} */ (snapshot).entries;
	if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) return null;
	/** @type {OriginRun[]} */
	const runs = [];
	for (const [key, tuple] of Object.entries(entries)) {
		if (!translationTuple(tuple)) return null;
		let run = runs.at(-1);
		if (!run || run.origin !== tuple[0]) { run = { origin: tuple[0], rows: [] }; runs.push(run); }
		run.rows.push([key, tuple[1], tuple[2]]);
	}
	return runs.length ? { entries, runs } : null;
}

/** @param {unknown} value @returns {value is [string, string, string]} */
function translationTuple(value) {
	return Array.isArray(value) && value.length === 3 && typeof value[0] === 'string'
		&& typeof value[1] === 'string' && typeof value[2] === 'string';
}

/** @param {unknown} value @param {Map<string, number>} counts @param {OriginTable | null} table */
function countStrings(value, counts, table) {
	if (table && value === table.entries) {
		for (const run of table.runs) {
			countStrings(run.origin, counts, null);
			for (const [, english, translation] of run.rows) {
				countStrings(english, counts, null); countStrings(translation, counts, null);
			}
		}
		return;
	}
	if (typeof value === 'string') counts.set(value, (counts.get(value) ?? 0) + 1);
	else if (Array.isArray(value)) for (const item of value) countStrings(item, counts, table);
	else if (value !== null && typeof value === 'object') {
		for (const item of Object.values(value)) countStrings(item, counts, table);
	}
}

/** @param {unknown} value @param {Map<string, string>} references @param {OriginTable | null} table @returns {string} */
function renderJsonValue(value, references, table) {
	if (table && value === table.entries) {
		const runs = table.runs.map(run => {
			const cells = run.rows.flatMap(([key, english, translation]) => [JSON.stringify(key),
				renderJsonValue(english, references, null), renderJsonValue(translation, references, null)]).join(',');
			return `...$e(${renderJsonValue(run.origin, references, null)},[${cells}])`;
		}).join(',');
		return `Object.fromEntries([${runs}])`;
	}
	if (typeof value === 'string') return references.get(value) ?? JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(item => renderJsonValue(item, references, table)).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		return `{${Object.entries(value).map(([key, item]) => {
			const property = key === '__proto__' ? '["__proto__"]' : JSON.stringify(key);
			return `${property}:${renderJsonValue(item, references, table)}`;
		}).join(',')}}`;
	}
	return JSON.stringify(value);
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
		&& Buffer.byteLength(JSON.stringify(source)) >= 16).map(([source]) => source).sort());
}

/** Only oversized lazy locales need additional independently bounded text modules.
 * @param {Record<string, unknown>} catalog @param {readonly string[]} sourceTexts
 * @returns {readonly (readonly string[])[]}
 */
function localeTextPools(catalog, sourceTexts) {
	const counts = new Map();
	countStrings(catalog, counts, null);
	const shared = new Set(sourceTexts), pools = [];
	// Leave room inside the existing target for the compiler's binding/export wrapper.
	const payloadLimit = MAXIMUM_LOCALE_TEXT_MODULE_BYTES - LOCALE_TEXT_COMPILER_RESERVE_BYTES;
	let texts = [], bytes = 20;
	for (const text of counts.keys()) {
		const length = Buffer.byteLength(JSON.stringify(text)) + 1;
		if (shared.has(text) || length < 16) continue;
		if (length + 20 > payloadLimit) throw new Error('Translation locale text exceeds the generated module budget.');
		if (bytes + length > payloadLimit && texts.length) {
			pools.push(texts); texts = []; bytes = 20;
		}
		texts.push(text); bytes += length;
	}
	if (texts.length) pools.push(texts);
	return pools;
}

/** Substitute only the generated index's lazy catalog imports during builds. */
export function createTranslationCatalogBundlePlugin() {
	/** @type {Map<string, { source: string, path: string }>} */
	const parts = new Map(), localeTextModules = new Map();
	/** @type {Map<string, object>} */
	const loads = new Map();
	/** @type {Promise<{ paths: string[], texts: readonly string[] }> | null} */
	let pendingPool = null;
	let epoch = {}, catalogDirectory = '';
	function loadPool() {
		const owner = epoch, directory = catalogDirectory;
		pendingPool ??= (async () => {
			const paths = (await readdir(directory)).filter(name => name.endsWith('.json')).sort()
				.map(name => join(directory, name));
			const catalogs = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8'))));
			if (epoch !== owner) throw new Error('Translation catalog load was superseded.');
			return { paths, texts: translationCatalogSourceTexts(catalogs) };
		})();
		return pendingPool;
	}
	return {
		name: 'scape:compact-translation-catalogs',
		enforce: /** @type {const} */ ('pre'),
		apply: /** @type {const} */ ('build'),
		buildStart() { epoch = {}; parts.clear(); loads.clear(); localeTextModules.clear(); pendingPool = null; },
		/** @param {string} source @param {string | undefined} importer */
		resolveId(source, importer) {
			if (source === SOURCE_POOL_SPECIFIER) return SOURCE_POOL_ID;
			if (source.startsWith(LOCALE_POOL_SPECIFIER)) {
				const id = `\0${source}${VIRTUAL_EXTENSION}`;
				return localeTextModules.has(id) ? id : null;
			}
			if (source.startsWith(TRANSLATION_CATALOG_PART_PREFIX)) {
				const part = parts.get(source);
				return part && importer === `${VIRTUAL_PREFIX}${part.path}${VIRTUAL_EXTENSION}` ? source : null;
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
				const owner = epoch;
				const pool = await loadPool();
				if (epoch !== owner) throw new Error('Translation catalog load was superseded.');
				for (const path of pool.paths) this.addWatchFile(path);
				return `export default ${JSON.stringify(pool.texts)};`;
			}
			if (id.startsWith(TRANSLATION_CATALOG_PART_PREFIX)) {
				const part = parts.get(id);
				if (!part) return null;
				this.addWatchFile(part.path); return part.source;
			}
			if (!id.startsWith(VIRTUAL_PREFIX)) return null;
			const path = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_EXTENSION.length);
			this.addWatchFile(path);
			const owner = epoch, load = {};
			loads.set(path, load);
			const assertCurrent = () => {
				if (epoch !== owner || loads.get(path) !== load) throw new Error('Translation catalog load was superseded.');
			};
			const bytes = await readFile(path, 'utf8'); assertCurrent();
			const catalog = JSON.parse(bytes), { texts } = await loadPool(); assertCurrent();
			const source = renderTranslationCatalogModule(catalog, texts);
			const minifiedBytes = Buffer.byteLength(source) < MAXIMUM_CATALOG_MODULE_BYTES ? 0
				: Buffer.byteLength(transformSync(source, { minify: true, charset: 'utf8' }).code);
			const pools = minifiedBytes < MAXIMUM_CATALOG_MODULE_BYTES ? [] : localeTextPools(catalog, texts).map((pool, index) => {
				const source = `export default ${JSON.stringify(pool)};`;
				const digest = createHash('sha256').update(path).update('\0').update(source).digest('hex');
				return { specifier: `${LOCALE_POOL_SPECIFIER}${basename(path)}:${digest}:${index}`, texts: pool, source };
			});
			const partition = partitionTranslationCatalog(catalog, value => renderTranslationCatalogModule(value, texts, pools));
			assertCurrent();
			for (const [partId, part] of parts) if (part.path === path) parts.delete(partId);
			for (const [index, source] of partition.parts.entries()) parts.set(translationCatalogPartId(path, index), { source, path });
			for (const pool of pools) localeTextModules.set(`\0${pool.specifier}${VIRTUAL_EXTENSION}`, { source: pool.source, path });
			return assembleTranslationCatalogModule(partition, path);
		},
	};
}
