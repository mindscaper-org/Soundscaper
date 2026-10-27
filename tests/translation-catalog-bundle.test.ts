/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transform } from 'esbuild';
import { rolldown } from 'rolldown';
import { COMMITTED_LOCALE_TAGS } from '../src/common/i18n/locales.js';

import {
	createTranslationCatalogBundlePlugin,
	renderTranslationCatalogModule,
	translationCatalogSourceTexts,
} from '../scripts/lib/translation-catalog-bundle.mjs';
import {
	assembleTranslationCatalogModule,
	partitionTranslationCatalog,
	translationCatalogPartId,
} from '../scripts/lib/translation-catalog-partition.mjs';
import { loadBundledTranslationCatalogModule } from './helpers/translation-catalog-module-loader.ts';

async function loadModule(source: string): Promise<Record<string, unknown>> {
	return await import(`data:text/javascript,${encodeURIComponent(source)}`) as Record<string, unknown>;
}

async function loadPartition(catalog: Record<string, unknown>): Promise<Record<string, unknown>> {
	const path = '/catalog.json', partition = partitionTranslationCatalog(catalog, renderTranslationCatalogModule);
	let source = assembleTranslationCatalogModule(partition, path);
	for (const [index, part] of partition.parts.entries()) {
		const { code } = await transform(part, { minify: true, charset: 'utf8' });
		assert.ok(Buffer.byteLength(code) < 490_000, 'Each generated catalog module retains the existing reserve.');
		source = source.replaceAll(JSON.stringify(translationCatalogPartId(path, index)),
			JSON.stringify(`data:text/javascript,${encodeURIComponent(code)}`));
	}
	const { code } = await transform(assembleTranslationCatalogModule(partition, path), { minify: true, charset: 'utf8' });
	assert.ok(Buffer.byteLength(code) < 490_000, 'The generated catalog root retains the existing reserve.');
	return await loadModule(source);
}

function literalModule(catalog: Record<string, unknown>): string {
	return [`const catalog = ${JSON.stringify(catalog)};`,
		...Object.keys(catalog).map(key => `export const ${key} = catalog.${key};`), 'export default catalog;'].join('\n');
}
function contiguousCatalog(count: number) {
	return { schemaVersion: 2, locale: 'fr', provenance: {}, entries: Object.fromEntries(
		Array.from({ length: count }, (_, index) => [`entry${index}`, ['machine', `English${index}`, `Texte${index}`]])) };
}
function originInternedModule(catalog: ReturnType<typeof contiguousCatalog>): string {
	const entries = Object.entries(catalog.entries).map(([key, tuple]) =>
		`${JSON.stringify(key)}:[$t0,${JSON.stringify(tuple[1])},${JSON.stringify(tuple[2])}]`).join(',');
	return ['const $t0="machine";', `const catalog={schemaVersion:2,locale:"fr",provenance:{},entries:{${entries}}};`,
		...Object.keys(catalog).map(key => `export const ${key}=catalog.${key};`), 'export default catalog;'].join('\n');
}

test('contiguous origin tables save complete emitted and minified bytes against an already-interned origin', async () => {
	const catalog = contiguousCatalog(256), before = JSON.stringify(catalog);
	const source = renderTranslationCatalogModule(catalog), baseline = originInternedModule(catalog);
	assert.match(source, /Object\.fromEntries/u, 'A profitable origin run should use the table representation.');
	assert.ok(Buffer.byteLength(source) < Buffer.byteLength(baseline), 'Charge the complete table factory and module exports.');
	const [compact, original] = await Promise.all([transform(source, { minify: true, charset: 'utf8' }),
		transform(baseline, { minify: true, charset: 'utf8' })]);
	assert.ok(Buffer.byteLength(compact.code) < Buffer.byteLength(original.code), 'Array keys stay quoted after minification; include that cost.');
	assert.deepEqual((await loadModule(compact.code)).default, catalog); assert.equal(JSON.stringify(catalog), before);
});

test('table tuples retain property order, prototype names, escaped Unicode and independent mutable arrays', async () => {
	const escaped = '";globalThis.catalogInjection=true;//\n\u2028\u2029\ud800\udfff\\';
	const entries = Object.fromEntries([
		['10', ['human', escaped, escaped]], ['2', ['machine', 'Numeric', 'Nombre']],
		['__proto__', ['audacity', 'Prototype', 'Prototype']], ['constructor', ['human', escaped, escaped]],
		...Object.entries(contiguousCatalog(256).entries),
		['last', ['audacity', 'Last', 'Dernier']],
	]);
	const catalog = { schemaVersion: 2, locale: 'fr', provenance: { machine: { model: 'Pinned' } }, entries,
		community: { constructor: { contributor: escaped } } }, before = JSON.stringify(catalog);
	const source = renderTranslationCatalogModule(catalog); assert.match(source, /Object\.fromEntries/u);
	const { code } = await transform(source, { minify: true, charset: 'utf8' }), module = await loadModule(code);
	const actual = module.default as typeof catalog;
	assert.deepEqual(actual, catalog); assert.deepEqual(Object.keys(actual.entries), Object.keys(catalog.entries));
	assert.equal(Object.getPrototypeOf(actual.entries), Object.prototype); assert.ok(Object.hasOwn(actual.entries, '__proto__'));
	assert.ok(Object.hasOwn(actual.entries, 'constructor')); assert.equal(module.entries, actual.entries);
	const constructorTuple: unknown = Object.getOwnPropertyDescriptor(actual.entries, 'constructor')?.value;
	assert.ok(Array.isArray(constructorTuple)); assert.notEqual(actual.entries.__proto__, constructorTuple);
	assert.equal(Reflect.has(globalThis, 'catalogInjection'), false);
	actual.entries.__proto__![1] = 'Authored';
	assert.equal(constructorTuple[1], escaped); assert.equal(JSON.stringify(catalog), before);
});

test('table admission preserves generic JSON shapes and its profitability boundary never regresses minified bytes', async () => {
	for (const invalid of [null, ['machine', 'English'], ['machine', 'English', 'Texte', 'extra'], [1, 'English', 'Texte'],
		['machine', undefined, 'Texte'], { arbitrary: true }]) {
		const catalog = { ...contiguousCatalog(128), entries: { ...contiguousCatalog(128).entries, invalid } };
		const source = renderTranslationCatalogModule(catalog); assert.doesNotMatch(source, /Object\.fromEntries/u);
		const { code } = await transform(source, { minify: true, charset: 'utf8' });
		assert.deepEqual((await loadModule(code)).default, JSON.parse(JSON.stringify(catalog)) as unknown);
	}
	for (const count of [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
		const catalog = contiguousCatalog(count), source = renderTranslationCatalogModule(catalog);
		// The existing renderer interns this sole repeated value only when its
		// complete emitted declaration pays for itself; retain that exact baseline.
		const saving = count * Buffer.byteLength('"machine"') - Buffer.byteLength('const $t0="machine";\n') - count * 3;
		const baseline = saving > 0 ? originInternedModule(catalog) : literalModule(catalog);
		const [compact, original] = await Promise.all([source, baseline]
			.map(value => transform(value, { minify: true, charset: 'utf8' })));
		assert.ok(Buffer.byteLength(compact!.code) <= Buffer.byteLength(original!.code),
			`Complete minified table costs must be profitable at ${count} entries.`);
		assert.deepEqual((await loadModule(compact!.code)).default, catalog);
	}
});

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

test('repeated escaped translation text compacts without interpreting tuple-like text or prototype keys', async () => {
	const english = 'Literal ["machine", "audacity", "human"] and {name}: \\ path\n'.repeat(8);
	const translated = 'Texte "__proto__": ["machine", `${globalThis.poisoned = true}`]\n\u2028\u2029\ud800\udfff'.repeat(6);
	const catalog = {
		schemaVersion: 2, locale: 'fr',
		provenance: JSON.parse('{"__proto__":{"license":"AGPL-3.0-only"}}') as unknown,
		entries: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
			index === 0 ? '__proto__' : `entry-${index}`,
			[index % 2 === 0 ? 'machine' : 'human', english, translated],
		])),
		community: Object.fromEntries([['__proto__', { previousEntry: ['audacity', english, translated] }]]),
	};
	const source = renderTranslationCatalogModule(catalog);
	assert.ok(Buffer.byteLength(source) < Buffer.byteLength(JSON.stringify(catalog)) / 2,
		'Repeated long strings should pay for their declarations and references.');
	const { code } = await transform(source, { minify: true, charset: 'utf8' });
	const module = await loadModule(code);
	assert.deepEqual(module.default, catalog);
	const actual = module.default as typeof catalog;
	assert.equal(Object.getPrototypeOf(actual.entries), Object.prototype);
	assert.equal(Object.getPrototypeOf(actual.community), Object.prototype);
	assert.ok(Object.hasOwn(actual.entries, '__proto__'));
	assert.ok(Object.hasOwn(actual.community, '__proto__'));
});

test('catalog rendering preserves JSON serialization semantics before interning values', async () => {
	const missing = Array<unknown>(3);
	missing[2] = 'human';
	const catalog = {
		schemaVersion: 2, locale: 'fr',
		provenance: { omitted: undefined, time: new Date('2026-10-08T00:00:00Z') },
		entries: { numbers: [NaN, Infinity, -Infinity, -0], missing },
		community: undefined,
	};
	const expected: unknown = JSON.parse(JSON.stringify(catalog));
	const source = renderTranslationCatalogModule(catalog);
	assert.deepEqual((await loadModule(source)).default, expected);
	const { code } = await transform(source, { minify: true, charset: 'utf8' });
	assert.deepEqual((await loadModule(code)).default, expected);
});

test('short repetitions and unique strings do not add an unprofitable string dictionary', async () => {
	const catalog = { schemaVersion: 2, locale: 'fr',
		entries: Array.from({ length: 64 }, (_, index) => ['a', 'b', `unique-${index}`]) };
	const source = renderTranslationCatalogModule(catalog);
	assert.ok(Buffer.byteLength(source) <= Buffer.byteLength(JSON.stringify(catalog)) + 256,
		'Short values must remain literals when references cannot recover their own cost.');
	assert.deepEqual((await loadModule(source)).default, catalog);
});

test('small but proven byte savings are retained after charging the complete declaration overhead', async () => {
	const catalog = { schemaVersion: 2, locale: 'fr',
		entries: { a: ['machine', 'Repeated value', 'Premier'], b: ['human', 'Repeated value', 'Deuxième'],
			c: ['audacity', 'Repeated value', 'Troisième'] } };
	const literalSource = [`const catalog = ${JSON.stringify(catalog)};`,
		...Object.keys(catalog).map(key => `export const ${key} = catalog.${key};`), 'export default catalog;'].join('\n');
	const source = renderTranslationCatalogModule(catalog);
	assert.ok(Buffer.byteLength(source) < Buffer.byteLength(literalSource),
		'Interning must recover its own complete declaration, reference and newline bytes.');
	const [compact, literal] = await Promise.all([transform(source, { minify: true, charset: 'utf8' }),
		transform(literalSource, { minify: true, charset: 'utf8' })]);
	assert.ok(Buffer.byteLength(compact.code) < Buffer.byteLength(literal.code));
	const actual = (await loadModule(compact.code)).default as typeof catalog;
	assert.deepEqual(actual, catalog); assert.notEqual(actual.entries.a, actual.entries.b);
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
	const id = plugin.resolveId('./hi.json', importer);
	assert.equal(typeof id, 'string');
	assert.ok(id);
	const watched: string[] = [];
	const source = await plugin.load.call({ addWatchFile: (path: string) => watched.push(path) }, id);
	assert.ok(source);
	const path = fileURLToPath(new URL('../src/common/i18n/translations/hi.json', import.meta.url));
	assert.deepEqual(watched, [path]);
	const catalog: unknown = JSON.parse(await readFile(path, 'utf8'));
	for (const match of source.matchAll(/^import \{entries as \$p\d+\} from ("(?:[^"\\]|\\.)*");$/gmu)) {
		const partId = JSON.parse(match[1]!) as string;
		assert.equal(plugin.resolveId(partId, id), partId);
		assert.equal(plugin.resolveId(partId, '/unrelated.js'), null);
		assert.ok(await plugin.load.call({ addWatchFile: (value: string) => watched.push(value) }, partId));
	}
	assert.ok(watched.every(value => value === path));
	assert.deepEqual((await loadBundledTranslationCatalogModule(plugin, source, id)).default, catalog);
	const poolId = plugin.resolveId('scape:translation-source-text', undefined); assert.ok(poolId);
	const poolPaths: string[] = [];
	assert.ok(await plugin.load.call({ addWatchFile: (value: string) => poolPaths.push(value) }, poolId));
	assert.deepEqual(poolPaths, (await readdir(dirname(path))).filter(name => name.endsWith('.json')).sort()
		.map(name => join(dirname(path), name)));
});

test('the complete Hindi catalog fits bounded production modules without removing entries', async () => {
	const catalog = JSON.parse(await readFile(new URL('../src/common/i18n/translations/hi.json', import.meta.url), 'utf8')) as Record<string, unknown>;
	assert.deepEqual((await loadPartition(catalog)).default, catalog);
});

test('every published machine catalog retains all tuples and named exports within the production ceiling', async t => {
	const locales = COMMITTED_LOCALE_TAGS.filter(locale => !['en', 'de'].includes(new Intl.Locale(locale).language));
	for (const locale of locales) await t.test(locale, async () => {
		const catalog = JSON.parse(await readFile(new URL(`../src/common/i18n/translations/${locale}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
		const module = await loadPartition(catalog); assert.deepEqual(module.default, catalog);
		for (const [key, value] of Object.entries(catalog)) assert.deepEqual(module[key], value, `${locale}.${key}`);
	});
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


test('the complete Russian catalog adds lazy text only beyond the unchanged module budget', async () => {
	const catalog = JSON.parse(await readFile(new URL('../src/common/i18n/translations/ru.json', import.meta.url), 'utf8')) as Record<string, unknown>;
	const plugin = createTranslationCatalogBundlePlugin();
	const importer = fileURLToPath(new URL('../src/common/i18n/translations/index.js', import.meta.url));
	const id = plugin.resolveId('./ru.json', importer);
	assert.ok(id);
	const source = await plugin.load.call({ addWatchFile() {} }, id);
	assert.ok(source);
	const sharedId = plugin.resolveId('scape:translation-source-text', undefined); assert.ok(sharedId);
	const sharedSource = await plugin.load.call({ addWatchFile() {} }, sharedId); assert.ok(sharedSource);
	const shared = (await loadModule(sharedSource)).default;
	assert.ok(Array.isArray(shared) && shared.every(value => typeof value === 'string'));
	const unsplit = await transform(renderTranslationCatalogModule(catalog, shared as readonly string[]), { minify: true, charset: 'utf8' });
	const requiresLocaleText = Buffer.byteLength(unsplit.code) >= 490_000;
	const { code } = await transform(source, { minify: true, charset: 'utf8' });
	assert.ok(Buffer.byteLength(code) < 490_000, `Russian locale module is ${Buffer.byteLength(code)} bytes`);
	let hasLocaleText = false;
	const module = await loadBundledTranslationCatalogModule(plugin, code, id, dependency => {
		hasLocaleText ||= dependency.specifier.startsWith('scape:translation-locale-text:');
	});
	assert.equal(hasLocaleText, requiresLocaleText, 'Only an oversized complete locale gains async text dependencies.');
	assert.deepEqual(module.default, catalog);
	for (const [key, value] of Object.entries(catalog)) assert.deepEqual(module[key], value);
	assert.equal(module.entries, (module.default as Record<string, unknown>).entries);
	assert.equal(module.provenance, (module.default as Record<string, unknown>).provenance);
	const sharedCode = await transform(sharedSource, { minify: true, charset: 'utf8' });
	assert.ok(Buffer.byteLength(sharedCode.code) < 490_000, 'The shared source text has its own unchanged chunk ceiling.');
});

test('a genuinely under-budget locale retains its synchronous catalog dependency graph', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-catalog-synchronous-'));
	const catalogs = join(directory, 'src/common/i18n/translations'), importer = join(catalogs, 'index.js');
	const catalog = (locale: string) => ({ schemaVersion: 2, locale, provenance: { human: { contributor: 'Example' } },
		entries: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`entry${index}`,
			['human', `Shared English source description ${index}`, `${locale} translation ${index}`]])) });
	const plugin = createTranslationCatalogBundlePlugin();
	try {
		await mkdir(catalogs, { recursive: true });
		for (const locale of ['ru', 'fr']) await writeFile(join(catalogs, `${locale}.json`), JSON.stringify(catalog(locale)));
		const id = plugin.resolveId('./ru.json', importer); assert.ok(id);
		const source = await plugin.load.call({ addWatchFile() {} }, id); assert.ok(source);
		const { code } = await transform(source, { minify: true, charset: 'utf8' });
		assert.ok(Buffer.byteLength(code) < 490_000);
		assert.doesNotMatch(source, /\bawait\b|\bimport\s*\(/u);
		const module = await loadBundledTranslationCatalogModule(plugin, code, id, dependency => {
			assert.equal(dependency.specifier, 'scape:translation-source-text');
			assert.doesNotMatch(dependency.source, /\bawait\b|\bimport\s*\(/u);
		});
		assert.deepEqual(module.default, catalog('ru'));
		assert.equal(module.entries, (module.default as Record<string, unknown>).entries);
	} finally { await rm(directory, { recursive: true, force: true }); }
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


test('shared English and lazy Hindi text retain complete catalogs within production module budgets', async () => {
	const catalog = JSON.parse(await readFile(new URL('../src/common/i18n/translations/hi.json', import.meta.url), 'utf8')) as Record<string, unknown>;
	const plugin = createTranslationCatalogBundlePlugin();
	const importer = fileURLToPath(new URL('../src/common/i18n/translations/index.js', import.meta.url));
	const id = plugin.resolveId('./hi.json', importer); assert.ok(id);
	const source = await plugin.load.call({ addWatchFile() {} }, id); assert.ok(source);
	const { code } = await transform(source, { minify: true, charset: 'utf8' });
	assert.ok(Buffer.byteLength(code) < 490_000, 'Leave room for the bundler runtime under the 500 KB ceiling.');
	const dependencies = new Set<string>();
	const module = await loadBundledTranslationCatalogModule(plugin, code, id, async dependency => {
		dependencies.add(dependency.specifier);
		const minified = await transform(dependency.source, { minify: true, charset: 'utf8' });
		assert.ok(Buffer.byteLength(minified.code) < 490_000, 'Every entry or text dependency keeps the unchanged chunk ceiling.');
	});
	assert.ok(dependencies.size >= 2);
	assert.ok(dependencies.has('scape:translation-source-text'), 'Hindi keeps the actual shared English text dependency.');
	assert.ok([...dependencies].some(value => value.startsWith('scape:translation-locale-text:')),
		'The real expanded Hindi catalog needs locale text beside English, not merely multiple entry parts.');
	assert.deepEqual(module.default, catalog);
	for (const [key, value] of Object.entries(catalog)) assert.deepEqual(module[key], value);
});

test('a locale reload preserves captured text pool bytes while publishing new content identities', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-catalog-pool-identity-'));
	const catalogs = join(directory, 'src/common/i18n/translations'), importer = join(catalogs, 'index.js');
	const plugin = createTranslationCatalogBundlePlugin();
	const original = JSON.parse(await readFile(new URL('../src/common/i18n/translations/hi.json', import.meta.url), 'utf8')) as {
		entries: Record<string, [string, string, string]>;
	};
	try {
		await mkdir(catalogs, { recursive: true });
		await writeFile(join(catalogs, 'hi.json'), JSON.stringify(original));
		await writeFile(join(catalogs, 'fr.json'), await readFile(new URL('../src/common/i18n/translations/fr.json', import.meta.url), 'utf8'));
		const id = plugin.resolveId('./hi.json', importer); assert.ok(id);
		const source = await plugin.load.call({ addWatchFile() {} }, id); assert.ok(source);
		const first = new Map<string, { specifier: string; source: string }>();
		assert.deepEqual((await loadBundledTranslationCatalogModule(plugin, source, id, dependency => {
			first.set(dependency.id, dependency);
		})).default, original);
		const oldPools = [...first].filter(([, value]) => value.specifier.startsWith('scape:translation-locale-text:'));
		assert.ok(oldPools.length > 0);
		const captured: readonly [string, { source: string }] = [...first].find(([, value]) => value.source.includes('scape:translation-locale-text:')) ?? [id, { source }];
		const before = await loadBundledTranslationCatalogModule(plugin, captured[1].source, captured[0]);
		const changed = structuredClone(original), key = Object.keys(changed.entries)[0]; assert.ok(key);
		changed.entries[key]![2] += ' Changed translated text with a fresh immutable pool binding.';
		await writeFile(join(catalogs, 'hi.json'), JSON.stringify(changed));
		const next = await plugin.load.call({ addWatchFile() {} }, id); assert.ok(next);
		const current = new Set<string>();
		assert.deepEqual((await loadBundledTranslationCatalogModule(plugin, next, id, dependency => {
			if (dependency.specifier.startsWith('scape:translation-locale-text:')) current.add(dependency.id);
		})).default, changed);
		assert.ok(oldPools.some(([poolId]) => !current.has(poolId)), 'Changed pool bytes receive a different virtual identity.');
		for (const [poolId, pool] of oldPools) {
			assert.equal(plugin.resolveId(pool.specifier, id), poolId);
			assert.equal(await plugin.load.call({ addWatchFile() {} }, poolId), pool.source);
		}
		assert.deepEqual(await loadBundledTranslationCatalogModule(plugin, captured[1].source, captured[0]), before);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('the shared English pool is immutable within a build and refreshes only in the next epoch', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-catalog-source-pool-'));
	const catalogs = join(directory, 'src/common/i18n/translations'), importer = join(catalogs, 'index.js');
	const plugin = createTranslationCatalogBundlePlugin(), initial = 'Initial shared English source text.', replacement = 'Replacement shared English source text.';
	const catalog = (locale: string, english: string) => ({ schemaVersion: 2, locale, entries: { key: ['human', english, locale] } });
	try {
		await mkdir(catalogs, { recursive: true });
		for (const locale of ['fr', 'de']) await writeFile(join(catalogs, `${locale}.json`), JSON.stringify(catalog(locale, initial)));
		const id = plugin.resolveId('./fr.json', importer); assert.ok(id);
		assert.ok(await plugin.load.call({ addWatchFile() {} }, id));
		const poolId = plugin.resolveId('scape:translation-source-text', undefined); assert.ok(poolId);
		const source = await plugin.load.call({ addWatchFile() {} }, poolId); assert.ok(source);
		assert.deepEqual((await loadModule(source)).default, [initial]);
		for (const locale of ['fr', 'de']) await writeFile(join(catalogs, `${locale}.json`), JSON.stringify(catalog(locale, replacement)));
		const reloaded = await plugin.load.call({ addWatchFile() {} }, id); assert.ok(reloaded);
		assert.deepEqual((await loadBundledTranslationCatalogModule(plugin, reloaded, id)).default, catalog('fr', replacement));
		assert.equal(await plugin.load.call({ addWatchFile() {} }, poolId), source);
		plugin.buildStart();
		assert.ok(await plugin.load.call({ addWatchFile() {} }, id));
		const refreshed = await plugin.load.call({ addWatchFile() {} }, poolId); assert.ok(refreshed);
		assert.notEqual(refreshed, source); assert.deepEqual((await loadModule(refreshed)).default, [replacement]);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
