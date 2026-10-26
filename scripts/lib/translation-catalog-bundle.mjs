/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const VIRTUAL_PREFIX = '\0scape:translation-catalog:';
const VIRTUAL_EXTENSION = '.mjs';
const CATALOG_INDEX_SUFFIX = '/src/common/i18n/translations/index.js';
const CATALOG_FIELDS = ['schemaVersion', 'locale', 'provenance', 'entries', 'community'];

/** @param {unknown} value */
function compactCatalogValue(value) {
	const normalized = JSON.parse(JSON.stringify(value));
	const counts = new Map();
	countStrings(normalized, counts);
	const strings = new Map([...counts].filter(([text, count]) => count > 1
		&& (['machine', 'audacity', 'human'].includes(text) || new TextEncoder().encode(JSON.stringify(text)).byteLength >= 16))
		.map(([text], index) => [text, `__catalogText_${index}`]));
	return {
		declarations: [...strings].map(([text, name]) => `const ${name} = ${JSON.stringify(text)};`),
		expression: catalogValue(normalized, strings),
	};
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

/** @param {Record<string, unknown>} entries @param {string} owner */
function renderCatalogPart(entries, owner) {
	const values = Object.fromEntries(Object.entries(entries)
		.filter(([key]) => translationOwner(key) === owner));
	const { declarations, expression } = compactCatalogValue(values);
	return [...declarations, `export default ${expression};`].join('\n');
}

/**
 * Keep the committed JSON and its runtime shape intact while sharing repeated
 * string values in each emitted owner. Keys remain literal and text stays
 * JSON-escaped; no catalog entry or provenance is removed.
 *
 * @param {Record<string, unknown>} catalog
 */
export function renderTranslationCatalogModule(catalog) {
	const { declarations, expression } = compactCatalogValue(catalog);
	return [
		...declarations,
		`const catalog = ${expression};`,
		...catalogExports(catalog),
	].join('\n');
}

/**
 * Substitute the generated index's lazy imports. A locale facade assembles its
 * core, Motion and Framescaper entries so the expanded catalog keeps its owners
 * below the production chunk ceiling without changing the committed catalog.
 */
export function createTranslationCatalogBundlePlugin() {
	/** @type {Map<string, { path: string, owner: string }>} */
	const parts = new Map();
	return {
		name: 'scape:compact-translation-catalogs',
		enforce: /** @type {const} */ ('pre'),
		apply: /** @type {const} */ ('build'),
		/** @param {string} source @param {string | undefined} importer */
		resolveId(source, importer) {
			if (parts.has(source)) return source;
			if (!importer?.replaceAll('\\', '/').endsWith(CATALOG_INDEX_SUFFIX)
				|| !/^\.\/[^/\\]+\.json$/u.test(source)) return null;
			return `${VIRTUAL_PREFIX}${resolve(dirname(importer), source)}${VIRTUAL_EXTENSION}`;
		},
		/** @this {{ addWatchFile(path: string): void }} @param {string} id */
		async load(id) {
			if (!id.startsWith(VIRTUAL_PREFIX)) return null;
			const part = parts.get(id);
			if (part) {
				this.addWatchFile(part.path);
				const catalog = JSON.parse(await readFile(part.path, 'utf8'));
				return renderCatalogPart(catalog.entries, part.owner);
			}
			const path = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_EXTENSION.length);
			this.addWatchFile(path);
			const catalog = JSON.parse(await readFile(path, 'utf8'));
			if (!Object.keys(catalog.entries).some(isMotionTranslation)) return renderTranslationCatalogModule(catalog);
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
