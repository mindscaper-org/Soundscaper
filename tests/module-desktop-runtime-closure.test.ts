/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';
import { DESKTOP_RUNTIME_BUNDLED_LEAF_FILES } from '../scripts/lib/desktop-5b-transitive-runtime-files.mjs';
import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-expected-runtime-files.mjs';
import { assertStagedDesktopImportsResolve } from '../scripts/lib/desktop-staged-import-hygiene.mjs';

const root = resolve(import.meta.dirname, '..');

void test('neutral desktop runtime modules close every bare package import into a bundled leaf', async () => {
	const leaves = new Set<string>(DESKTOP_RUNTIME_BUNDLED_LEAF_FILES);
	for (const file of DESKTOP_EXPECTED_RUNTIME_FILES) {
		if (!/^src\/common\/(?:foundation|imaging|media|scape)\//u.test(file)) continue;
		const source = await readFile(resolve(root, file.replace(/\.js$/u, '.ts')), 'utf8');
		const packages = ts.preProcessFile(source, true, true).importedFiles
			.map(reference => reference.fileName).filter(specifier => !specifier.startsWith('.') && !specifier.startsWith('node:'));
		if (packages.length) assert.ok(leaves.has(file), `${file} retains bare package imports unless bundled: ${packages.join(', ')}`);
	}
});

void test('the extracted media digest runs from a staged module without any node_modules', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'neutral-desktop-runtime-'));
	try {
		const result = await build({ entryPoints: [resolve(root, 'src/common/media/bytes.ts')],
			bundle: true, platform: 'node', format: 'esm', target: 'node26', write: false, logLevel: 'silent' });
		assert.equal(result.outputFiles.length, 1);
		const destination = join(directory, 'bytes.mjs');
		await writeFile(destination, result.outputFiles[0]!.contents);
		await assertStagedDesktopImportsResolve(directory);
		const staged = await import(pathToFileURL(destination).href) as { digestBytes(bytes: Uint8Array): string };
		assert.equal(staged.digestBytes(new Uint8Array([97, 98, 99])), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	} finally { await rm(directory, { recursive: true, force: true }); }
});
