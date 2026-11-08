/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import type { EncodedSourceMap } from '@jridgewell/trace-mapping';
import { assertBuiltLightscaperGpuCoverage } from '../scripts/lib/browser-gpu-production-coverage.mjs';

// Tooling remapper control only; existing genuine UI tests qualify real GPU execution.
test('portable raw profiles remap executed built functions without reading synthetic artifact paths', async context => {
	const root = await mkdtemp(join(tmpdir(), 'gpu-portable-coverage-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const outputDirectory = join(root, '.wrangler/browser-products/lightscaper');
	await mkdir(join(outputDirectory, 'assets'), { recursive: true });
	const source = 'function execute(){return 7;}\nexecute();\n';
	const paths = ['src/common/editor/imaging/image-develop-gpu-current-v1.ts', 'src/common/editor/imaging/pixel-frame-webgl2-context-current-v1.ts'];
	const result = paths.map((_, index) => ({ url: `file:///__soundscaper_e2e__/browser/lightscaper/assets/gpu-${String(index)}.js`, functions: [
		{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
		{ functionName: 'execute', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: source.indexOf('\n'), count: 1 }] },
	] }));
	const maps: Record<string, { data: EncodedSourceMap }> = {};
	for (const [index, path] of paths.entries()) {
		const original = join(root, path); await mkdir(dirname(original), { recursive: true }); await writeFile(original, source);
		await writeFile(join(outputDirectory, `assets/gpu-${String(index)}.js`), source);
		maps[result[index]!.url] = { data: { version: 3, names: [], sources: [`file:///__soundscaper_repo__/${path}`], sourcesContent: [source], mappings: 'AAAA;AACA' } };
	}
	const hits = await assertBuiltLightscaperGpuCoverage({ result, 'source-map-cache': maps }, { repositoryRoot: root, outputDirectory });
	assert.deepEqual(hits.map(hit => hit.path), paths); assert.ok(hits.every(hit => hit.executedFunctions > 0 && hit.executedStatements > 0));
});
