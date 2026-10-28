/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { rolldown, type OutputChunk } from 'rolldown';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { chunkGroupsForBuild } from '../scripts/lib/build-chunk-groups.mjs';

async function generate(modules: Readonly<Record<string, string>>, main: string): Promise<OutputChunk[]> {
	const bundle = await rolldown({
		input: main, preserveEntrySignatures: 'allow-extension',
		plugins: [{
			name: 'bounded-successor-lazy-owner-fixture',
			resolveId: id => Object.hasOwn(modules, id) ? id : null,
			load: id => modules[id] ?? null,
		}],
	});
	try {
		const result = await bundle.generate({
			format: 'es', minify: true, strictExecutionOrder: true,
			codeSplitting: { groups: chunkGroupsForBuild({ compositionLinkEntry: true }), minSize: 20_000 },
		});
		return result.output.filter((value): value is OutputChunk => value.type === 'chunk');
	} finally { await bundle.close(); }
}

function reached(chunks: readonly OutputChunk[], entry: string): Set<string> {
	const root = chunks.find(chunk => chunk.facadeModuleId === entry)
		?? chunks.find(chunk => Object.hasOwn(chunk.modules, entry));
	assert.ok(root);
	const modules = new Set<string>(), visited = new Set<string>();
	const visit = (chunk: OutputChunk): void => {
		if (visited.has(chunk.fileName)) return;
		visited.add(chunk.fileName);
		for (const id of Object.keys(chunk.modules)) modules.add(id);
		for (const dependency of chunk.imports) {
			const imported = chunks.find(value => value.fileName === dependency);
			assert.ok(imported); visit(imported);
		}
	};
	visit(root); return modules;
}

test('eager Motion values cannot import the lazy CanvasKit decoration implementation', async () => {
	const main = '/fixture/src/main.jsx';
	const values = '/fixture/src/common/editor/motion-values.ts';
	const decoration = '/fixture/src/common/editor/motion-effect-decoration.ts';
	const effect = '/fixture/src/common/editor/motion-canvaskit-effect.ts';
	const filter = '/fixture/src/common/editor/motion-canvaskit-filter.ts';
	const modules = {
		[main]: `import { value } from '${values}'; globalThis.scene = value; globalThis.render = () => import('${effect}');`,
		[values]: `export const value = ${JSON.stringify('scene '.repeat(4_000))};`,
		[decoration]: `import { blur } from '${filter}'; export const decorate = () => blur();`,
		[effect]: `import { decorate } from '${decoration}'; export const render = () => decorate();`,
		[filter]: 'export const blur = () => { globalThis.rasterTouched = true; return "pixels"; };',
	};
	const chunks = await generate(modules, main), eager = reached(chunks, main), rendering = reached(chunks, effect);
	assert.ok(eager.has(values));
	for (const id of [decoration, filter, effect]) {
		assert.equal(eager.has(id), false, `${id} must remain behind the render import`);
		assert.ok(rendering.has(id));
		assert.ok(chunks.find(chunk => Object.hasOwn(chunk.modules, id))?.fileName.startsWith('motion-raster'));
	}
});

test('eager successor inspection keeps the actual archive ZIP imports behind archive operations', async () => {
	const main = '/fixture/src/main.jsx';
	const runtime = '/fixture/src/framescaper/editor-project-successor-runtime.ts';
	const writer = '/fixture/src/framescaper/editor-project-successor-archive.ts';
	const zip = '/fixture/node_modules/@zip.js/zip.js/index-native.js';
	const shared = '/fixture/archive-contracts.js';
	const input = '/fixture/archive-input.js';
	const reader = '/fixture/archive-reader.js';
	const source = await readFile(resolve(import.meta.dirname, '../src/framescaper/editor-project-successor-archive.ts'), 'utf8');
	const compiled = transpileModule(source, { compilerOptions: { target: ScriptTarget.ESNext, module: ModuleKind.ESNext } }).outputText;
	const archive = compiled.replace(/(?:from\s*|import\()(['"])([^'"]+)\1/gu, (match: string, quote: string, specifier: string) => {
		const replacement = specifier === '@zip.js/zip.js/index-native.js' ? zip
			: specifier.endsWith('/scape-project-input.ts') ? input : shared;
		return match.replace(`${quote}${specifier}${quote}`, `${quote}${replacement}${quote}`);
	});
	const modules = {
		[main]: `import { open } from '${runtime}'; globalThis.open = open; globalThis.exportArchive = () => import('${writer}');`,
		[runtime]: `import { inspectFramescaperMigrationArchive } from '${writer}'; export const open = archive => inspectFramescaperMigrationArchive(archive);`,
		[writer]: archive,
		[input]: `export async function withScapeProjectInput(value, signal, action) { return action(await (await import('${reader}')).read(value, signal)); }`,
		[reader]: `import { ZipReader } from '${zip}'; export const read = value => new ZipReader(value);`,
		[zip]: `globalThis.zipLoaded = ${JSON.stringify('zip-codecs '.repeat(3_000))}; export class ZipWriter {} export class ZipReader {} export class BlobWriter {} export class TextReader {}`,
		[shared]: 'export const sha256 = {}, bytesToHex = globalThis.bytesToHex, createBlobScapeArchiveByteSource = globalThis.byteSource, assertScapeArchiveByteSource = globalThis.assertByteSource, readScapeArchiveByteRange = globalThis.byteRange, copyScapeArchiveEntry = globalThis.copyEntry, readScapeArchiveEnvelope = globalThis.envelope, EXTERNAL_MEDIA_ENCODING = "external", verifyScapeAssetBytes = globalThis.verifyAsset, indexScapeProjectAssets = globalThis.indexAssets, indexScapeProjectTimingAssets = globalThis.indexTiming, cloneFramescaperProject = globalThis.cloneProject, createFramescaperScapeProjectAssetExtension = globalThis.assetExtension, FRAMESCAPER_PROJECT_RUNTIME_PROFILE = {}, normalizeFramescaperSuccessorProject = globalThis.normalizeProject;',
	};
	const chunks = await generate(modules, main), eager = reached(chunks, main);
	assert.ok(eager.has(writer), 'the real inspection API remains synchronously importable');
	assert.equal(eager.has(zip), false, 'ZIP must load only when inspection or export actually begins');
	assert.ok(reached(chunks, reader).has(zip), 'archive reading retains its actual ZIP dependency');
	assert.ok(chunks.some(chunk => Object.hasOwn(chunk.modules, zip)), 'the deferred ZIP implementation remains emitted');
});
