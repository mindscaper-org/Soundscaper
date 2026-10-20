/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { absoluteSourceMapSources } from '../scripts/lib/build-source-map-relocation.mjs';
import { assertBuiltLightscaperGpuCoverage } from '../scripts/lib/browser-gpu-production-coverage.mjs';

const SOURCES = ['src/common/editor/imaging/image-develop-gpu-current-v1.ts',
	'src/common/editor/imaging/pixel-frame-webgl2-context-current-v1.ts'];
const CODE = 'function execute(){return 7;}\nexecute();\n';
interface FunctionCoverage { functionName: string; isBlockCoverage: boolean; ranges: { startOffset: number; endOffset: number; count: number }[] }
interface Entry { url: string; functions: FunctionCoverage[] }
interface CachedMap { lineLengths: number[]; data: { version: 3; names: string[]; sources: string[]; sourcesContent?: Array<string | null>; x_soundscaper_source_sha256?: Array<string | null>; mappings: string } }
async function fixture(context: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'browser-built-gpu-profile-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const outputDirectory = join(root, '.wrangler/browser-products/lightscaper');
	await mkdir(join(outputDirectory, 'assets'), { recursive: true });
	const profile: { result: Entry[]; 'source-map-cache': Record<string, CachedMap> } = { result: [], 'source-map-cache': {} };
	for (const [index, source] of SOURCES.entries()) {
		const original = join(root, source); await mkdir(dirname(original), { recursive: true }); await writeFile(original, CODE);
		const built = join(outputDirectory, `assets/gpu-${String(index)}.js`); await writeFile(built, CODE);
		const url = pathToFileURL(built).href;
		profile.result.push({ url, functions: [
			{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: CODE.length, count: 1 }] },
			{ functionName: 'execute', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: CODE.indexOf('\n'), count: 1 }] },
		] });
		profile['source-map-cache'][url] = { lineLengths: [CODE.indexOf('\n'), 'execute();'.length], data: {
			version: 3, names: [], sources: [pathToFileURL(original).href], sourcesContent: [CODE], mappings: 'AAAA;AACA',
		} };
	}
	return { root, outputDirectory, profile, options: { repositoryRoot: root, outputDirectory } };
}

test('maintained V8 remapping requires actually called functions in both built GPU owners', async context => {
	const f = await fixture(context), result = await assertBuiltLightscaperGpuCoverage(f.profile, f.options);
	assert.deepEqual(result.map(value => value.path), SOURCES);
	assert.ok(result.every(value => value.executedFunctions > 0 && value.executedStatements > 0));
});

test('map presence and module initialization alone never qualify built GPU execution', async context => {
	const f = await fixture(context);
	for (const entry of f.profile.result) entry.functions = entry.functions.slice(0, 1);
	await assert.rejects(assertBuiltLightscaperGpuCoverage(f.profile, f.options), /executed|GPU|coverage/iu);
});

test('uncalled GPU functions remain zero despite an executed landing or module profile', async context => {
	const f = await fixture(context);
	for (const entry of f.profile.result) entry.functions[1]!.ranges[0]!.count = 0;
	await assert.rejects(assertBuiltLightscaperGpuCoverage(f.profile, f.options), /executed|GPU|coverage/iu);
});

test('helper copies and nonbuilt paths cannot satisfy either shipped owner', async context => {
	const f = await fixture(context);
	for (const entry of f.profile.result) {
		const map = f.profile['source-map-cache'][entry.url]!; delete f.profile['source-map-cache'][entry.url];
		entry.url = pathToFileURL(join(f.root, '__observer.js')).href; f.profile['source-map-cache'][entry.url] = map;
	}
	await assert.rejects(assertBuiltLightscaperGpuCoverage(f.profile, f.options), /executed|GPU|coverage/iu);
});

/** Use the actual build owner, which removes text and preserves its exact SHA. */
function relocateFixtureMaps(f: Awaited<ReturnType<typeof fixture>>): void {
	for (const entry of f.profile.result) {
		const map = f.profile['source-map-cache'][entry.url]!.data;
		const relocated = absoluteSourceMapSources(map, join(f.outputDirectory, 'assets'), f.root);
		assert.equal(relocated.sourcesContent, undefined); assert.deepEqual(relocated.sources, map.sources);
		const digests: unknown = relocated.x_soundscaper_source_sha256; assert.ok(Array.isArray(digests));
		map.x_soundscaper_source_sha256 = digests.map((value: unknown) => {
			assert.ok(typeof value === 'string'); assert.match(value, /^[a-f0-9]{64}$/u); return value;
		});
		delete map.sourcesContent;
	}
}

test('actual relocated build-map digests restore exact owner bytes before counting executed GPU functions and statements', async context => {
	const f = await fixture(context); relocateFixtureMaps(f);
	const before = JSON.stringify(f.profile['source-map-cache']);
	const result = await assertBuiltLightscaperGpuCoverage(f.profile, f.options);
	assert.ok(result.every(value => value.executedFunctions > 0 && value.executedStatements > 0));
	assert.equal(JSON.stringify(f.profile['source-map-cache']), before, 'authentication must not rewrite the retained raw map');
});

test('a changed checkout owner never authenticates against an earlier relocated build digest', async context => {
	const f = await fixture(context); relocateFixtureMaps(f);
	await writeFile(join(f.root, SOURCES[0]!), CODE.replace('return 7', 'return 8'));
	await assert.rejects(assertBuiltLightscaperGpuCoverage(f.profile, f.options), /source.*bytes|build-time|digest/iu);
});

test('a relocated source map without its build digest cannot hydrate unproven checkout text', async context => {
	const f = await fixture(context); relocateFixtureMaps(f);
	for (const map of Object.values(f.profile['source-map-cache'])) delete map.data.x_soundscaper_source_sha256;
	await assert.rejects(assertBuiltLightscaperGpuCoverage(f.profile, f.options), /source.*bytes|build-time|digest/iu);
});

test('embedded owner text must match its actual owning source even when V8 function offsets still match', async context => {
	const f = await fixture(context);
	for (const map of Object.values(f.profile['source-map-cache'])) map.data.sourcesContent = [CODE.replace('return 7', 'return 8')];
	await assert.rejects(assertBuiltLightscaperGpuCoverage(f.profile, f.options), /source.*bytes|build-time|digest/iu);
});

test('an embedded owner cannot override a conflicting build-time source digest', async context => {
	const f = await fixture(context); relocateFixtureMaps(f);
	for (const map of Object.values(f.profile['source-map-cache'])) {
		map.data.sourcesContent = [CODE]; map.data.x_soundscaper_source_sha256 = ['0'.repeat(64)];
	}
	await assert.rejects(assertBuiltLightscaperGpuCoverage(f.profile, f.options), /source.*bytes|build-time|digest/iu);
});


test('one actual relocated chunk proves both GPU owners independently while unrelated omitted text cannot supply their hits', async context => {
	const f = await fixture(context), helper = 'src/common/editor/imaging/unrelated-helper.ts';
	await writeFile(join(f.root, helper), CODE);
	const built = join(f.outputDirectory, 'assets/combined-gpu.js'), combined = CODE.repeat(3), url = pathToFileURL(built).href;
	await writeFile(built, combined);
	for (const key of Object.keys(f.profile['source-map-cache'])) delete f.profile['source-map-cache'][key];
	f.profile.result.splice(0, f.profile.result.length, { url, functions: [
		{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: combined.length, count: 1 }] },
		...[0, 1, 2].map(index => ({ functionName: `execute-${String(index)}`, isBlockCoverage: true,
			ranges: [{ startOffset: index * CODE.length, endOffset: index * CODE.length + CODE.indexOf('\n'), count: 1 }] })),
	] });
	f.profile['source-map-cache'][url] = { lineLengths: Array.from({ length: 3 }, () => [CODE.indexOf('\n'), 'execute();'.length]).flat(), data: {
		version: 3, names: [], sources: [...SOURCES, helper].map(source => pathToFileURL(join(f.root, source)).href),
		sourcesContent: [CODE, CODE, CODE], mappings: 'AAAA;AACA;ACDA;AACA;ACDA;AACA',
	} };
	relocateFixtureMaps(f);
	assert.ok((await assertBuiltLightscaperGpuCoverage(f.profile, f.options)).every(value => value.executedFunctions > 0 && value.executedStatements > 0));
	f.profile.result[0]!.functions[2]!.ranges[0]!.count = 0;
	await assert.rejects(assertBuiltLightscaperGpuCoverage(f.profile, f.options), /executed broker and WebGL functions/iu);
});


// Tooling range/map controls only; the actual built UI cases still require
// native render/readback assertions separately from this proof helper.
for (const host of ['pixel-frame-webgl2-current-v1.ts', 'pixel-frame-webgl2-masked-host-current-v1.ts']) {
	void test(`${host} calls the exact shared native context owner`, async () => {
		const source = await readFile(new URL('../src/common/editor/imaging/' + host, import.meta.url), 'utf8');
		assert.match(source, /await import\('\.\/pixel-frame-webgl2-context-current-v1\.ts'\)/u);
		assert.match(source, /native\.openPixelFrameWebGl2ContextCurrentV1\(/u);
		const context = await readFile(new URL('../src/common/editor/imaging/pixel-frame-webgl2-context-current-v1.ts', import.meta.url), 'utf8');
		for (const call of ['createShader', 'compileShader', 'linkProgram', 'drawArrays', 'readPixels']) {
			assert.ok(context.includes('native.' + call + '('), call);
		}
	});

	void test(`executed shared GL context qualifies the ${host} route without calling the other host`, async context => {
		const f = await fixture(context), hostSource = join(f.root, 'src/common/editor/imaging', host);
		await writeFile(hostSource, CODE);
		const built = join(f.outputDirectory, 'assets/branch-host.js'), url = pathToFileURL(built).href;
		await writeFile(built, CODE);
		f.profile.result.push({ url, functions: [
			{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: CODE.length, count: 1 }] },
			{ functionName: 'execute', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: CODE.indexOf('\n'), count: 0 }] },
		] });
		f.profile['source-map-cache'][url] = { lineLengths: [CODE.indexOf('\n'), 'execute();'.length], data: {
			version: 3, names: [], sources: [pathToFileURL(hostSource).href], sourcesContent: [CODE], mappings: 'AAAA;AACA',
		} };
		relocateFixtureMaps(f);
		const hits = await assertBuiltLightscaperGpuCoverage(f.profile, f.options);
		assert.deepEqual(hits.map(hit => hit.path), SOURCES);
		assert.ok(hits.every(hit => hit.executedFunctions > 0 && hit.executedStatements > 0));
	});

	void test(`an executed ${host} cannot substitute for unobserved shared GL execution`, async context => {
		const f = await fixture(context), hostSource = join(f.root, 'src/common/editor/imaging', host);
		await writeFile(hostSource, CODE);
		f.profile['source-map-cache'][f.profile.result[1]!.url]!.data.sources = [pathToFileURL(hostSource).href];
		relocateFixtureMaps(f);
		await assert.rejects(assertBuiltLightscaperGpuCoverage(f.profile, f.options), /executed broker and WebGL functions/iu);
	});
}

for (const index of [0, 1]) void test(`mapped owner ${String(index)} must have its own called function, not just module statements`, async context => {
	const f = await fixture(context); relocateFixtureMaps(f);
	f.profile.result[index]!.functions[1]!.ranges[0]!.count = 0;
	await assert.rejects(assertBuiltLightscaperGpuCoverage(f.profile, f.options), /executed broker and WebGL functions/iu);
});
