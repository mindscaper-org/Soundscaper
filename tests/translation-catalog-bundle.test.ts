/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { transform } from 'esbuild';
import { rolldown, type OutputChunk } from 'rolldown';

import { chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import {
	createTranslationCatalogBundlePlugin,
	renderTranslationCatalogModule,
	translationCatalogSourceTexts,
} from '../scripts/lib/translation-catalog-bundle.mjs';

async function loadModule(source: string): Promise<Record<string, unknown>> {
	return await import(`data:text/javascript,${encodeURIComponent(source)}`) as Record<string, unknown>;
}

async function bundleModuleSource(plugin: ReturnType<typeof createTranslationCatalogBundlePlugin>, source: string,
	onDependency?: (source: string) => Promise<void>) {
	for (const match of source.matchAll(/(?:from\s*|import\()\s*("(?:[^"\\]|\\.)*")/gu)) {
		const specifier: unknown = JSON.parse(match[1]!.replace(/\\0(?!\d)/gu, '\\u0000').replace(/\\x([\da-f]{2})/giu, '\\u00$1'));
		assert.equal(typeof specifier, 'string');
		const id = plugin.resolveId(specifier as string, undefined);
		if (!id) continue;
		const dependency = await plugin.load.call({ addWatchFile() {} }, id);
		assert.ok(dependency);
		await onDependency?.(dependency);
		const url = `data:text/javascript,${encodeURIComponent(await bundleModuleSource(plugin, dependency, onDependency))}`;
		source = source.replace(match[0], match[0].replace(match[1]!, JSON.stringify(url)));
	}
	return source;
}

async function loadBundledModule(plugin: ReturnType<typeof createTranslationCatalogBundlePlugin>, source: string,
	onDependency?: (source: string) => Promise<void>) {
	return loadModule(await bundleModuleSource(plugin, source, onDependency));
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
	const pool = `export default ${JSON.stringify([english, translated])};`;
	const splitSource = renderTranslationCatalogModule(catalog, [], [{ specifier: 'test:locale-text', texts: [english, translated] }]);
	const module = await loadModule(splitSource.replace('"test:locale-text"', JSON.stringify(`data:text/javascript,${encodeURIComponent(pool)}`)));
	assert.deepEqual(module.default, catalog, 'The additional lazy text module preserves escaped and attributed values.');
	for (const [key, value] of Object.entries(catalog)) assert.deepEqual(module[key], value);
});

test('the bundle plugin only substitutes lazy imports from the generated catalog index', async () => {
	const plugin = createTranslationCatalogBundlePlugin();
	const importer = fileURLToPath(new URL('../src/common/i18n/translations/index.js', import.meta.url));
	assert.equal(plugin.resolveId('./hi.json', '/workspace/another/index.js'), null);
	assert.equal(plugin.resolveId('../hi.json', importer), null);
	assert.equal(plugin.resolveId('./hi.json?raw', importer), null);
	assert.equal(plugin.resolveId('scape:translation-locale-text:unregistered', importer), null);
	assert.equal(await plugin.load.call({ addWatchFile() {} }, '\0unrelated'), null);
	const id = plugin.resolveId('./af.json', importer);
	assert.equal(typeof id, 'string');
	assert.ok(id);
	const watched: string[] = [];
	const source = await plugin.load.call({ addWatchFile: (path: string) => watched.push(path) }, id);
	assert.ok(source);
	const path = fileURLToPath(new URL('../src/common/i18n/translations/af.json', import.meta.url));
	assert.deepEqual(watched, [path]);
	const catalog: unknown = JSON.parse(await readFile(path, 'utf8'));
	assert.deepEqual((await loadBundledModule(plugin, source)).default, catalog);
});

test('expanded locale fragments retain semantic owners and assemble the exact catalog', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'translation-catalog-owners-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const translations = join(directory, 'src/common/i18n/translations');
	await mkdir(translations, { recursive: true });
	const entries = {
		core: Object.fromEntries([['__proto__', ['human', 'Prototype', 'Prototype traduit']],
			['ui.transport.play', ['audacity', 'Play', 'Lecture']]]),
		motion: { 'ui.motionscaper.play': ['machine', 'Play motion', 'Lire le mouvement'] },
		framescaper: {
			'ui.framescaperNative.queuePause': ['human', 'Pause queue', 'Suspendre la file'],
			'ui.framescaperFinishing.apply': ['machine', 'Apply finishing', 'Appliquer la finition'],
		},
	};
	const catalog = { schemaVersion: 2, locale: 'fr',
		provenance: { machine: { model: 'gpt-6-luna' }, audacity: { licenseSpdx: 'GPL-3.0-only' } },
		entries: { ...entries.core, ...entries.motion, ...entries.framescaper },
		community: { 'ui.framescaperNative.queuePause': { contributor: 'A translator' } } };
	await writeFile(join(translations, 'fr.json'), JSON.stringify(catalog));
	const plugin = createTranslationCatalogBundlePlugin();
	const id = plugin.resolveId('./fr.json', join(translations, 'index.js'));
	assert.ok(id);
	const loader = { addWatchFile() {} };
	let facade = await plugin.load.call(loader, id);
	assert.ok(facade);
	for (const owner of ['core', 'motion', 'framescaper'] as const) {
		const partId: string = id.replace(/[.]mjs$/u, `.${owner}.mjs`);
		assert.ok(facade.includes(`import(${JSON.stringify(partId)})`), `${owner} stays independently lazy.`);
		const source = await plugin.load.call(loader, partId);
		assert.ok(source);
		assert.deepEqual((await loadModule(source)).default, entries[owner], owner);
		facade = facade.replace(JSON.stringify(partId), JSON.stringify(`data:text/javascript,${encodeURIComponent(source)}`));
	}
	const built = await loadModule(facade);
	assert.deepEqual(built.default, catalog);
	for (const [key, value] of Object.entries(catalog)) assert.deepEqual(built[key], value);
});

test('production chunks preserve complete catalogs within the chunk budget', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'translation-catalog-bundle-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const importer = fileURLToPath(new URL('../src/common/i18n/translations/index.js', import.meta.url));
	const bundle = await rolldown({
		input: importer,
		preserveEntrySignatures: 'allow-extension',
		plugins: [createTranslationCatalogBundlePlugin()],
	});
	try {
		const result = await bundle.write({
			dir: directory, format: 'es', minify: true, strictExecutionOrder: true,
			entryFileNames: 'index.mjs', chunkFileNames: '[name]-[hash].mjs',
			codeSplitting: { groups: chunkGroups, minSize: 20_000 },
		});
		const chunks = result.output.filter((item): item is OutputChunk => item.type === 'chunk');
		for (const chunk of chunks) {
			assert.ok(Buffer.byteLength(chunk.code) < 490_000,
				`${chunk.fileName} must leave room under the unchanged 500 KB ceiling.`);
		}
		for (const owner of ['core', 'motion', 'framescaper']) {
			assert.ok(chunks.some(chunk => chunk.fileName.startsWith(`translation-hi-${owner}-`)),
				`The complete Hindi catalog must keep its ${owner} owner separate.`);
		}
		const entry = chunks.find(chunk => chunk.isEntry);
		assert.ok(entry);
		const pending = [entry];
		const visited = new Set<string>();
		for (const chunk of pending) {
			if (visited.has(chunk.fileName)) continue;
			visited.add(chunk.fileName);
			assert.ok(Object.keys(chunk.modules).every(id => !id.startsWith('\0scape:translation-catalog:')),
				'Catalog bytes stay behind the locale loader.');
			for (const name of chunk.imports) {
				const dependency = chunks.find(candidate => candidate.fileName === name);
				assert.ok(dependency);
				pending.push(dependency);
			}
		}
		for (const name of entry.dynamicImports) {
			const locale = chunks.find(chunk => chunk.fileName === name);
			assert.ok(locale);
			assert.ok(locale.imports.every(dependency => !dependency.startsWith('translation-')),
				`${name} must keep expanded catalog data out of the boot preload list.`);
		}
		const built = await import(pathToFileURL(join(directory, 'index.mjs')).href) as {
			TRANSLATION_CATALOG_LOADERS: Record<string, () => Promise<{ default: Record<string, unknown> }>>;
		};
		for (const [locale, load] of Object.entries(built.TRANSLATION_CATALOG_LOADERS)) {
			const catalog: unknown = JSON.parse(await readFile(new URL(`../src/common/i18n/translations/${locale}.json`, import.meta.url), 'utf8'));
			assert.deepEqual((await load()).default, catalog, locale);
		}
	} finally { await bundle.close(); }
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
	let dependencies = 0;
	const module = await loadBundledModule(plugin, code, async dependency => {
		dependencies++;
		const minified = await transform(dependency, { minify: true, charset: 'utf8' });
		assert.ok(Buffer.byteLength(minified.code) < 490_000, 'Each lazy text dependency stays below the unchanged chunk ceiling.');
	});
	assert.ok(dependencies >= 2, 'The expanded Hindi catalog keeps its data in separate lazy modules.');
	assert.deepEqual(module.default, catalog);
	for (const [key, value] of Object.entries(catalog)) assert.deepEqual(module[key], value);
});

test('the production bundler keeps oversized Hindi text separate and lazy while ordinary locale imports stay synchronous', async () => {
	const plugin = createTranslationCatalogBundlePlugin();
	const importer = fileURLToPath(new URL('../src/common/i18n/translations/index.js', import.meta.url));
	const entry = 'translation-budget-entry.mjs';
	const bundle = await rolldown({ input: entry, plugins: [{ name: 'catalog-budget-fixture',
		resolveId(source, owner) { return source === entry ? entry : plugin.resolveId(source, owner === entry ? importer : owner); },
		async load(id) {
			return id === entry ? 'export const hindi = () => import("./hi.json"); export const french = () => import("./fr.json");'
				: await plugin.load.call({ addWatchFile() {} }, id);
		},
	}] });
	try {
		const { output } = await bundle.generate({ format: 'es', minify: true });
		const chunks = output.filter(item => item.type === 'chunk');
		const main = chunks.find(chunk => chunk.isEntry);
		assert.ok(main); assert.equal(main.imports.length, 0, 'Neither locale nor its text may become an eager dependency.');
		assert.ok(chunks.some(chunk => !chunk.isEntry && chunk.dynamicImports.length > 0), 'Locale-only text stays in a real dynamic chunk.');
		for (const chunk of chunks) assert.ok(Buffer.byteLength(chunk.code) < 490_000, `${chunk.fileName} exceeds the production budget margin.`);
	} finally { await bundle.close(); }
});


test('expanded Russian catalog fits a locale chunk while retaining all source text and provenance', async () => {
	const catalog = JSON.parse(await readFile(new URL('../src/common/i18n/translations/ru.json', import.meta.url), 'utf8')) as Record<string, unknown>;
	const plugin = createTranslationCatalogBundlePlugin();
	const importer = fileURLToPath(new URL('../src/common/i18n/translations/index.js', import.meta.url));
	const id = plugin.resolveId('./ru.json', importer);
	assert.ok(id);
	const source = await plugin.load.call({ addWatchFile() {} }, id);
	assert.ok(source);
	assert.equal(source.includes('scape:translation-locale-text:'), false, 'Locales already under budget retain their existing module graph.');
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
