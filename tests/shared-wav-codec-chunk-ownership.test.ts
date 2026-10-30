/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { createSourceFile, isExportDeclaration, isImportDeclaration, isStringLiteral, ScriptTarget } from 'typescript';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { resolveRelativeModule, sourceModules } from './helpers/eager-chunk-group-crossings.ts';

const OWNER = 'editor-codec-foundations';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EDITOR_DIRECTORY = fileURLToPath(new URL('../src/common/editor/', import.meta.url));
const CODEC_LEAVES = [
	'adm-authored-objects.ts', 'adm-axml-document.ts', 'adm-bed-layout.ts', 'adm-chna.ts',
	'adm-metadata.ts', 'adm-normalization-guards.ts', 'adm-sxml.ts', 'adm-xml-compression.ts',
	'broadcast-wave.ts', 'broadcast-wave-normalization.ts', 'cart-metadata.ts', 'id3-artwork.ts', 'id3-descriptive-fields.ts',
	'id3-frame-values.ts', 'id3-metadata.js', 'id3-structured-metadata.ts', 'id3-validation-failure.ts', 'ixml.ts', 'media-metadata.ts',
	'pcm-chunks.js', 'pcm-dither.js', 'riff-info.ts', 'riff-markers.ts', 'riff-metadata-text.ts',
	'riff-streaming-size.ts', 'voc-pcm-sample-rate.ts', 'wav-adm-import.ts', 'wav-adm-riff-sequence.ts',
	'wav-adpcm-source-geometry.ts', 'wav-ds64.js', 'wav-import-io.ts', 'wav-import.js',
	'wav-metadata-finalize.ts', 'wav-opaque-chunks.ts', 'wav-pcm-chunk-reader.ts', 'wav.js',
	'wave64-pcm-source-geometry.ts',
] as const;
// Main's BEXT/ID3 validation and sink settlement have no UI or timeline imports.
const SUPPORT_MODULES: ReadonlyMap<string, string> = new Map([
	['../foundation/abort-race.ts', 'editor-neutral-foundations'],
	['file-validation-failure.ts', 'editor-neutral-foundations'],
	['format-file-failure.ts', 'editor-neutral-foundations'],
	['pcm-stream-settlement.ts', 'editor-neutral-foundations'],
	['../i18n/editor-file-validation-copy.ts', 'editor-neutral-foundations'],
	['../i18n/editor-id3-metadata-copy.ts', 'editor-neutral-foundations'],
	['../i18n/editor-copy-scope.ts', 'editor-neutral-foundations'],
	['../i18n/editor-copy-origin.ts', 'editor-neutral-foundations'],
	['../i18n/presentation-message.ts', 'editor-presentation'],
]);

test('WAV container codecs have exact foundational ownership independent of path separator', () => {
	assert.equal(CODEC_LEAVES.length, 37);
	for (const leaf of CODEC_LEAVES) {
		const path = `src/common/editor/${leaf}`;
		for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), OWNER, path);
			for (const foreign of [path + '.foreign', path.replace(/\.(?:js|ts)$/u, '-future.ts'), path.replace('editor/', 'editor/internal/')]) {
				assert.notEqual(chunkGroupForModulePath(foreign.replaceAll('/', separator)), OWNER, foreign);
			}
		}
	}
	for (const [leaf, owner] of SUPPORT_MODULES) {
		const path = relative(ROOT, resolve(EDITOR_DIRECTORY, leaf)).split(sep).join('/');
		for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), owner, path);
			for (const foreign of [path + '.foreign', path.replace(/\.ts$/u, '-future.ts'), path.replace('common/', 'common/internal/')]) {
				assert.notEqual(chunkGroupForModulePath(foreign.replaceAll('/', separator)), owner, foreign);
			}
		}
	}
});

test('the actual WAV codec runtime closure contains only its finite codecs, exact localized failure support and existing XML vendors', () => {
	const allowed = new Set<string>(CODEC_LEAVES);
	const packages = new Set<string>(), reached = new Set<string>(), pending: string[] = [...CODEC_LEAVES];
	while (pending.length) {
		const leaf = pending.pop()!; if (reached.has(leaf)) continue; reached.add(leaf);
		const path = `${EDITOR_DIRECTORY}${leaf}`;
		for (const specifier of runtimeImports(path)) {
			if (!specifier.startsWith('.')) { packages.add(specifier); continue; }
			const target = resolveRelativeModule(path, specifier);
			assert.ok(target, `${leaf} imports unavailable ${specifier}`);
			const targetLeaf = relative(EDITOR_DIRECTORY, target).split(sep).join('/');
			assert.doesNotMatch(targetLeaf, /(?:^|\/)(?:controller|ui|storage)\//u, `${leaf} imports ${targetLeaf}`);
			assert.ok(allowed.has(targetLeaf) || SUPPORT_MODULES.has(targetLeaf), `${leaf} imports unrelated ${targetLeaf}`);
			assert.equal(chunkGroupForModulePath(target), SUPPORT_MODULES.get(targetLeaf) ?? OWNER, targetLeaf);
			pending.push(targetLeaf);
		}
	}
	assert.deepEqual([...reached].filter(leaf => !allowed.has(leaf)).sort(), [...SUPPORT_MODULES.keys()].sort());
	assert.deepEqual([...packages].sort(), ['fflate', 'saxes']);
});

test('paid neutral and presentation co-owners cannot turn codec failure support into timeline or catalog chunks', () => {
	const paid = new Set(['editor-neutral-foundations', 'editor-presentation']);
	const modules = sourceModules(resolve(ROOT, 'src')).filter(path => !path.endsWith('.d.ts'));
	const coowners = modules.filter(path => paid.has(chunkGroupForModulePath(path) ?? ''));
	assert.deepEqual(coowners.filter(path => chunkGroupForModulePath(path) === 'editor-presentation')
		.map(path => relative(ROOT, path).split(sep).join('/')).sort(), [
		'src/common/i18n/presentation-message.ts', 'src/common/i18n/presentation-progress.ts', 'src/common/i18n/translation-scope.ts',
	]);
	// These existing neutral co-owners consume only inert suffix and image admission contracts.
	const protocols = new Map([
		['src/common/project-file-extensions.ts', 'product-profiles'],
		['src/common/editor/import-file-extensions.ts', 'project-interchange-foundations'],
		['src/common/imaging/image-import-admission.ts', 'editor-imaging'],
	]);
	const pending = [...SUPPORT_MODULES.keys()].map(leaf => resolve(EDITOR_DIRECTORY, leaf));
	const reached = new Set<string>(), charged = new Set<string>(), packages = new Set<string>();
	while (pending.length) {
		const path = pending.pop()!, name = relative(ROOT, path).split(sep).join('/');
		if (reached.has(name)) continue; reached.add(name);
		const owner = chunkGroupForModulePath(path);
		assert.notEqual(owner, 'editor-domain', name); assert.notEqual(owner, 'editor-copy', name);
		assert.doesNotMatch(name, /(?:^|\/)(?:controller|ui|storage)\//u);
		if (owner && paid.has(owner)) {
			if (!charged.has(owner)) { charged.add(owner); pending.push(...coowners.filter(file => chunkGroupForModulePath(file) === owner)); }
		} else assert.equal(owner, protocols.get(name), `Unexpected paid dependency ${name}`);
		for (const specifier of runtimeImports(path)) {
			if (!specifier.startsWith('.')) { packages.add(specifier); continue; }
			const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target);
		}
	}
	assert.deepEqual([...charged].sort(), [...paid].sort());
	assert.deepEqual([...reached].filter(path => !coowners.includes(resolve(ROOT, path))).sort(), [...protocols.keys()].sort());
	assert.deepEqual([...packages].sort(), ['@noble/hashes/sha2.js', '@noble/hashes/utils.js']);
});

function runtimeImports(path: string): readonly string[] {
	const source = transformSync(readFileSync(path, 'utf8'), { sourcefile: path, loader: path.endsWith('.ts') ? 'ts' : 'js', format: 'esm' }).code;
	assert.doesNotMatch(source, /\bimport\s*\(/u, path);
	return createSourceFile(path, source, ScriptTarget.ESNext, true).statements.flatMap(statement => {
		if (!isImportDeclaration(statement) && !isExportDeclaration(statement)) return [];
		const specifier = statement.moduleSpecifier;
		return specifier && isStringLiteral(specifier) ? [specifier.text] : [];
	});
}
