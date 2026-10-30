/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import * as limits from '../src/common/scape/archive-limits.ts';
import { SCAPE_FORMAT, SCAPE_FORMAT_VERSION, SCAPE_MANIFEST_ENTRY, SCAPE_PROJECT_ENTRY } from '../src/common/scape/archive-envelope.ts';
import * as bytes from '../src/common/media/bytes.ts';
import { maximumScapeStoreArchiveBytes } from '../src/common/editor/scape-export-estimate.ts';
import { maximumScapeStoreCentralDirectoryBytes } from '../src/common/scape/archive-zip-profile.ts';
import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-runtime.mjs';
import { DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-baseline-runtime-files.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EDITOR = 'src/common/editor/';
const FOUNDATIONS = ['src/common/scape/archive-limits.ts', 'src/common/media/bytes.ts',
	'src/common/editor/scape-export-estimate.ts', 'src/common/scape/archive-zip-profile.ts', 'src/common/editor/scape-blob-budget.ts'];

test('neutral archive limits preserve the exact frozen format-1 public contract', () => {
	assert.equal(SCAPE_FORMAT, 'scape-project');
	assert.equal(SCAPE_FORMAT_VERSION, 1);
	assert.equal(SCAPE_MANIFEST_ENTRY, 'manifest.json');
	assert.equal(SCAPE_PROJECT_ENTRY, 'project.json');
	const expected: Readonly<limits.ScapeArchiveLimits> = {
		maximumEntryCount: 4_096,
		maximumManifestBytes: 32 * 1024 * 1024,
		maximumProjectBytes: 256 * 1024 * 1024,
		maximumExpandedBytes: 64 * 1024 * 1024 * 1024,
	};
	assert.deepEqual(limits.SCAPE_ARCHIVE_LIMITS, expected);
	assert.equal(Object.isFrozen(limits.SCAPE_ARCHIVE_LIMITS), true);
});

test('neutral byte and digest primitives preserve the format-1 byte outputs', () => {
	assert.equal(bytes.hex(Uint8Array.of(0, 1, 15, 16, 255)), '00010f10ff');
	assert.equal(bytes.digestBytes(new Uint8Array()),
		'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
	const input = new TextEncoder().encode('abc');
	assert.equal(bytes.digestBytes(input),
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	const digest = bytes.createDigest();
	digest.update(input.subarray(0, 1));
	digest.update(input.subarray(1));
	assert.equal(bytes.hex(digest.digest()), bytes.digestBytes(input));
});

test('byte streams snapshot exactly the supplied view before later source mutation', async () => {
	const backing = Uint8Array.of(99, 0, 17, 255, 88);
	const stream = bytes.bytesStream(backing.subarray(1, 4));
	backing.fill(42);
	assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()), Uint8Array.of(0, 17, 255));
	assert.equal((await new Response(bytes.bytesStream(new Uint8Array())).arrayBuffer()).byteLength, 0);
});

test('archive estimates retain the UTF-8 profile and entry-count ceilings', () => {
	const entries = [{ filename: 'média/ß.bin', payloadBytes: 13 }];
	const filenameBytes = new TextEncoder().encode(entries[0]!.filename).byteLength;
	assert.equal(maximumScapeStoreArchiveBytes(entries), 98 + 238 + 13 + 2 * filenameBytes);
	assert.equal(maximumScapeStoreCentralDirectoryBytes(entries), 46 + 65 + 8 + filenameBytes);
	const tooMany = Array.from({ length: limits.SCAPE_ARCHIVE_LIMITS.maximumEntryCount + 1 },
		(_, index) => ({ filename: String(index), payloadBytes: 0 }));
	assert.throws(() => maximumScapeStoreArchiveBytes(tooMany), /too many entries/iu);
	assert.throws(() => maximumScapeStoreCentralDirectoryBytes(tooMany), /too many entries/iu);
});

test('the actual emitted export foundation graph contains only neutral leaves and SHA-256', () => {
	const pending = [...FOUNDATIONS], seen = new Set<string>(), packages = new Set<string>();
	while (pending.length) {
		const member = pending.pop()!;
		if (seen.has(member)) continue;
		seen.add(member);
		for (const specifier of emittedDependencies(member)) {
			if (specifier.startsWith('.')) {
				pending.push(relative(ROOT, resolve(ROOT, dirname(member), specifier)).split(sep).join('/').replace(/\.js$/u, '.ts'));
			} else packages.add(specifier);
		}
	}
	assert.deepEqual([...seen].sort(), [...FOUNDATIONS].sort());
	assert.deepEqual([...packages], ['@noble/hashes/sha2.js']);
});

test('existing desktop archive modules emit references to staged neutral leaf files', () => {
	for (const [owner, leaf] of [['scape-archive-envelope.ts', 'scape/archive-envelope'],
		['scape-archive-media.ts', 'media/bytes'], ['scape-export-estimate.ts', 'scape/archive-zip-profile']] as const) {
		assert.ok(emittedDependencies(EDITOR + owner).includes(`../${leaf}.js`));
		const output = `src/common/${leaf}.js`;
		assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes(output), output);
	}
	for (const leaf of ['scape-export-estimate', 'scape-blob-budget']) {
		const output = EDITOR + leaf + '.js';
		assert.ok(DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES.includes(output), output);
		assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes(output), output);
	}
});

function emittedDependencies(member: string): string[] {
	const output = ts.transpileModule(readFileSync(resolve(ROOT, member), 'utf8'), {
		fileName: member,
		compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024,
			rewriteRelativeImportExtensions: true },
	}).outputText;
	const parsed = ts.createSourceFile(member, output, ts.ScriptTarget.ES2024);
	const specifiers: string[] = [];
	for (const statement of parsed.statements) {
		if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
		if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) specifiers.push(statement.moduleSpecifier.text);
	}
	return specifiers;
}
