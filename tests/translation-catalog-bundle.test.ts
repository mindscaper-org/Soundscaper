/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transform } from 'esbuild';

import {
	createTranslationCatalogBundlePlugin,
	renderTranslationCatalogModule,
	translationCatalogSourceTexts,
} from '../scripts/lib/translation-catalog-bundle.mjs';

async function loadModule(source: string): Promise<Record<string, unknown>> {
	return await import(`data:text/javascript,${encodeURIComponent(source)}`) as Record<string, unknown>;
}

async function loadBundledModule(plugin: ReturnType<typeof createTranslationCatalogBundlePlugin>, source: string) {
	const id = plugin.resolveId('scape:translation-source-text', undefined);
	assert.ok(id);
	const shared = await plugin.load.call({ addWatchFile() {} }, id);
	assert.ok(shared);
	return loadModule(source.replace('"scape:translation-source-text"', JSON.stringify(`data:text/javascript,${encodeURIComponent(shared)}`)));
}

test('compact catalogs retain translation tuples, provenance and community attribution exactly', async () => {
	const catalog = {
		schemaVersion: 2,
		locale: 'fr',
		provenance: { machine: { model: 'gpt-6-luna' }, audacity: { licenseSpdx: 'GPL-3.0-only' } },
		entries: Object.fromEntries([
			['__proto__', ['human', 'Old English', 'Texte']],
			['a', ['machine', 'Use {name}\n"machine"', 'Utiliser {name}\n"machine"']],
			['b', ['audacity', 'Play', 'Lecture']],
			['c', ['human', 'Close', 'Fermer']],
		]),
		community: { c: { contributor: 'A translator', previousEntry: ['machine', 'Close', 'Fermer'] } },
	};
	const module = await loadModule(renderTranslationCatalogModule(catalog));
	assert.deepEqual(module.default, catalog);
	for (const [key, value] of Object.entries(catalog)) assert.deepEqual(module[key], value);
});

test('repeated catalog text compacts without changing literal keys or escaped values', async () => {
	const english = 'Repeated English with "quotes", \\paths,\nnewlines and a literal __catalogText_0';
	const translated = 'बार-बार दोहराया गया पाठ — 日本語 😀 __proto__';
	const catalog = { schemaVersion: 2, locale: 'hi', entries: Object.fromEntries([
		...Array.from({ length: 40 }, (_, index) => [String(index), ['machine', english, translated]]),
		['__proto__', ['human', english, translated]],
		[english, ['audacity', translated, english]],
	]), community: { previousEntry: ['machine', english, translated] } };
	const { code } = await transform(renderTranslationCatalogModule(catalog), { minify: true, charset: 'utf8' });
	assert.ok(Buffer.byteLength(code) < Buffer.byteLength(JSON.stringify(catalog)) / 2,
		'repeated source and translated text should leave room without deleting catalog content');
	assert.deepEqual((await loadModule(code)).default, catalog);
});

test('the bundle plugin only substitutes lazy imports from the generated catalog index', async () => {
	const plugin = createTranslationCatalogBundlePlugin();
	const importer = fileURLToPath(new URL('../src/common/i18n/translations/index.js', import.meta.url));
	assert.equal(plugin.resolveId('./hi.json', '/workspace/another/index.js'), null);
	assert.equal(plugin.resolveId('../hi.json', importer), null);
	assert.equal(plugin.resolveId('./hi.json?raw', importer), null);
	assert.equal(await plugin.load.call({ addWatchFile() {} }, '\0unrelated'), null);
	const id = plugin.resolveId('./hi.json', importer);
	assert.equal(typeof id, 'string');
	assert.ok(id);
	const watched: string[] = [];
	const source = await plugin.load.call({ addWatchFile: (path: string) => watched.push(path) }, id);
	assert.ok(source);
	const path = fileURLToPath(new URL('../src/common/i18n/translations/hi.json', import.meta.url));
	assert.deepEqual(watched, [path]);
	const catalog: unknown = JSON.parse(await readFile(path, 'utf8'));
	assert.deepEqual((await loadBundledModule(plugin, source)).default, catalog);
});

test('the complete Hindi catalog fits the production chunk budget without removing entries', async () => {
	const catalog = JSON.parse(await readFile(new URL('../src/common/i18n/translations/hi.json', import.meta.url), 'utf8')) as Record<string, unknown>;
	const plugin = createTranslationCatalogBundlePlugin();
	const importer = fileURLToPath(new URL('../src/common/i18n/translations/index.js', import.meta.url));
	const id = plugin.resolveId('./hi.json', importer);
	assert.ok(id);
	const source = await plugin.load.call({ addWatchFile() {} }, id);
	assert.ok(source);
	const { code } = await transform(source, { minify: true, charset: 'utf8' });
	assert.ok(Buffer.byteLength(code) < 490_000, 'Leave room for the bundler runtime under the 500 KB ceiling.');
	assert.deepEqual((await loadBundledModule(plugin, code)).default, catalog);
});


test('expanded Russian catalog fits a locale chunk while retaining all source text and provenance', async () => {
	const catalog = JSON.parse(await readFile(new URL('../src/common/i18n/translations/ru.json', import.meta.url), 'utf8')) as Record<string, unknown>;
	const plugin = createTranslationCatalogBundlePlugin();
	const importer = fileURLToPath(new URL('../src/common/i18n/translations/index.js', import.meta.url));
	const id = plugin.resolveId('./ru.json', importer);
	assert.ok(id);
	const source = await plugin.load.call({ addWatchFile() {} }, id);
	assert.ok(source);
	const { code } = await transform(source, { minify: true, charset: 'utf8' });
	assert.ok(Buffer.byteLength(code) < 490_000, `Russian locale module is ${Buffer.byteLength(code)} bytes`);
	assert.deepEqual((await loadBundledModule(plugin, code)).default, catalog);
	const sharedId = plugin.resolveId('scape:translation-source-text', undefined);
	assert.ok(sharedId);
	const sharedSource = await plugin.load.call({ addWatchFile() {} }, sharedId);
	assert.ok(sharedSource);
	const sharedCode = await transform(sharedSource, { minify: true, charset: 'utf8' });
	assert.ok(Buffer.byteLength(sharedCode.code) < 490_000, 'The shared source text has its own unchanged chunk ceiling.');
});


test('cross-locale source sharing preserves escaped values, literal keys and attributed previous entries', async () => {
	const english = 'Repeated English with "quotes", \\paths,\nnewlines and __proto__';
	const a = { schemaVersion: 2, locale: 'fr', entries: { a: ['machine', english, 'Texte\nfrançais'] },
		community: { a: { previousEntry: ['audacity', english, 'Ancien\ntexte'], contributor: 'Example' } } };
	const b = { schemaVersion: 2, locale: 'de', entries: { b: ['human', english, 'Deutscher\nText'] } };
	const pool = translationCatalogSourceTexts([a, b]);
	assert.deepEqual(pool, [english]);
	assert.deepEqual(translationCatalogSourceTexts([a]), [], 'Repeated entries in one catalog stay locally owned.');
	for (const catalog of [a, b]) {
		const source = renderTranslationCatalogModule(catalog, pool);
		const sharedModule = `export default ${JSON.stringify(pool)};`;
		const shared: string = `data:text/javascript,${encodeURIComponent(sharedModule)}`;
		assert.deepEqual((await loadModule(source.replace('"scape:translation-source-text"', JSON.stringify(shared)))).default, catalog);
	}
});
