/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { createSourceFile, forEachChild, isIdentifier, isNewExpression, isStringLiteralLike, ScriptTarget, type Node } from 'typescript';
import { NIGHTLY_TEST_PAYLOAD_INPUTS, stageDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-staging.mjs';
import { createFixture } from './helpers/nightly-tests-staging-fixture.js';
import { physicalEsbuildInputPaths } from './helpers/esbuild-metafile-inputs.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SPEC = 'tests/browser/audio-editor-media-native-publication.spec.js';
const HELPERS = ['tests/helpers/video-storage-native-publication-fixture.ts', 'tests/helpers/video-storage-opfs-model-fixture.ts'] as const;
const closure = readClosure();

void test('the actual native media spec URL and complete browser program retain exactly their two helper files', async () => {
	const graph = await closure;
	assert.deepEqual(graph.filter(path => path.startsWith('tests/helpers/')).sort(), [...HELPERS].sort());
	for (const path of ['src/common/editor/storage.js', 'src/common/editor/storage/indexeddb-backend.ts',
		'src/common/editor/storage/media-asset-path-staging.ts', 'src/common/editor/storage/opfs-repository.ts']) assert.ok(graph.includes(path), path);
	assertAdmitted(graph, NIGHTLY_TEST_PAYLOAD_INPUTS);
	for (const path of HELPERS) assert.deepEqual(NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source === path)
		.map(({ source, destination, kind }) => ({ source, destination, kind })), [{ source: path, destination: path, kind: 'file' }]);
	assert.equal(NIGHTLY_TEST_PAYLOAD_INPUTS.some(input => input.source === 'tests/helpers' && input.kind === 'directory'), false);
});

void test('omitting either exact helper refuses the actual native media esbuild closure', async () => {
	const graph = await closure;
	for (const path of HELPERS) assert.throws(() => assertAdmitted(graph, NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source !== path)),
		error => error instanceof Error && error.message.includes(path));
});

void test('nightly staging retains both actual helper bytes and a missing source cannot replace a previous valid payload', async context => {
	const fixture = await createFixture(context);
	const originals = await Promise.all(HELPERS.map(path => readFile(resolve(ROOT, path))));
	for (const [index, path] of HELPERS.entries()) assert.deepEqual(await readFile(resolve(fixture.repositoryRoot, path)), originals[index]);
	await stageDesktopNightlyTests(fixture);
	for (const [index, path] of HELPERS.entries()) assert.deepEqual(await readFile(resolve(fixture.outputRoot, path)), originals[index]);
	for (const [index, path] of HELPERS.entries()) {
		await rm(resolve(fixture.repositoryRoot, path));
		try {
			await assert.rejects(stageDesktopNightlyTests(fixture), error => error instanceof Error && error.message.includes(path));
			for (const [at, retained] of HELPERS.entries()) assert.deepEqual(await readFile(resolve(fixture.outputRoot, retained)), originals[at]);
		} finally { await writeFile(resolve(fixture.repositoryRoot, path), originals[index]!); }
	}
});

async function readClosure(): Promise<string[]> {
	const spec = createSourceFile(SPEC, await readFile(resolve(ROOT, SPEC), 'utf8'), ScriptTarget.Latest, true), entries: string[] = [];
	function visit(node: Node): void {
		if (isNewExpression(node) && isIdentifier(node.expression) && node.expression.text === 'URL'
			&& node.arguments?.length === 2 && isStringLiteralLike(node.arguments[0]!)
			&& node.arguments[1]!.getText() === 'import.meta.url') entries.push(node.arguments[0]!.text);
		forEachChild(node, visit);
	}
	visit(spec); assert.deepEqual(entries, ['../helpers/video-storage-native-publication-fixture.ts']);
	const bundle = await build({ absWorkingDir: ROOT, entryPoints: [resolve(ROOT, 'tests/browser', entries[0]!)],
		bundle: true, write: false, platform: 'browser', format: 'esm', metafile: true, external: ['module'], logLevel: 'silent' });
	for (const output of Object.values(bundle.metafile.outputs)) assert.ok(output.imports.every(value => value.external && value.path === 'module'));
	return physicalEsbuildInputPaths(bundle.metafile);
}
function assertAdmitted(paths: readonly string[], inputs: typeof NIGHTLY_TEST_PAYLOAD_INPUTS): void {
	for (const path of paths.filter(value => !value.startsWith('node_modules/'))) {
		assert.ok(inputs.some(input => input.kind === 'file' ? input.source === path && input.destination === path
			: path.startsWith(input.source + '/') && input.source === input.destination
				&& !('exclude' in input && input.exclude.has(path.slice(input.source.length + 1).split('/')[0]!))), 'nightly graph omits ' + path);
	}
}
