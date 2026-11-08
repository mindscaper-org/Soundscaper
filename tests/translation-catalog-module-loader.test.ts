/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { transform } from 'esbuild';
import { createTranslationCatalogBundlePlugin } from '../scripts/lib/translation-catalog-bundle.mjs';
import { translationCatalogPartId } from '../scripts/lib/translation-catalog-partition.mjs';
import { loadBundledTranslationCatalogModule } from './helpers/translation-catalog-module-loader.ts';

test('the module loader evaluates actual minified catalog imports, re-exports and dynamic imports with shared identity', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-catalog-minified-imports-'));
	const catalogs = join(directory, 'src/common/i18n/translations'), path = join(catalogs, 'fr.json');
	const catalog = { schemaVersion: 2, locale: 'fr', entries: Object.fromEntries(Array.from({ length: 160 }, (_, index) => [
		`entry${index}`, ['machine', `English ${index}: ${'Long English source. '.repeat(50)}`,
			`Texte ${index}: ${'Longue traduction. '.repeat(50)}`],
	])) };
	try {
		await mkdir(catalogs, { recursive: true }); await writeFile(path, JSON.stringify(catalog));
		const plugin = createTranslationCatalogBundlePlugin(), id = plugin.resolveId('./fr.json', join(catalogs, 'index.js'));
		assert.ok(id);
		const source = await plugin.load.call({ addWatchFile() {} }, id); assert.ok(source);
		const firstPart = translationCatalogPartId(path, 0);
		assert.equal(plugin.resolveId(firstPart, id), firstPart, 'The real catalog must produce an owned entries part.');
		const extended = `${source}\nexport {entries as firstEntries} from ${JSON.stringify(firstPart)};\n`
			+ `export const readFirst=()=>import(${JSON.stringify(firstPart)});`;
		const { code } = await transform(extended, { minify: true, charset: 'utf8' });
		assert.ok(code.includes('\\0scape:translation-catalog-part:'), 'The fixture exercises JavaScript NUL escapes that JSON cannot parse.');
		const observed: string[] = [];
		const module = await loadBundledTranslationCatalogModule(plugin, code, id, dependency => { observed.push(dependency.id); });
		assert.deepEqual(module.default, catalog);
		assert.equal(observed.filter(value => value === firstPart).length, 1, 'All three import forms use one dependency instance.');
		assert.equal(typeof module.readFirst, 'function');
		const first = await (module.readFirst as () => Promise<Record<string, unknown>>)();
		assert.equal(first.entries, module.firstEntries);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('the module loader leaves import-looking literals and comments unchanged', async () => {
	const plugin = createTranslationCatalogBundlePlugin();
	const source = `export const note='import("scape:translation-locale-text:literal")';\n`
		+ `export default {note, from:'export * from "scape:translation-source-text"'};\n`
		+ '// import("scape:translation-locale-text:comment")\n'
		+ '/* export * from "scape:translation-source-text"; */';
	const dependencies: string[] = [];
	const module = await loadBundledTranslationCatalogModule(plugin, source, '/catalog-literals.mjs', dependency => {
		dependencies.push(dependency.specifier);
	});
	assert.deepEqual(dependencies, []);
	assert.equal(module.note, 'import("scape:translation-locale-text:literal")');
	assert.deepEqual(module.default, { note: module.note, from: 'export * from "scape:translation-source-text"' });
});
