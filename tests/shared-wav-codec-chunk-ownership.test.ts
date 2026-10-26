/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { resolveRelativeModule, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const OWNER = 'editor-codec-foundations';
const EDITOR_DIRECTORY = fileURLToPath(new URL('../src/common/editor/', import.meta.url));
const CODEC_LEAVES = [
	'adm-authored-objects.ts', 'adm-axml-document.ts', 'adm-bed-layout.ts', 'adm-chna.ts',
	'adm-metadata.ts', 'adm-normalization-guards.ts', 'adm-sxml.ts', 'adm-xml-compression.ts',
	'broadcast-wave.ts', 'cart-metadata.ts', 'id3-artwork.ts', 'id3-descriptive-fields.ts',
	'id3-frame-values.ts', 'id3-metadata.js', 'id3-structured-metadata.ts', 'ixml.ts', 'media-metadata.ts',
	'pcm-chunks.js', 'pcm-dither.js', 'riff-info.ts', 'riff-markers.ts', 'riff-metadata-text.ts',
	'riff-streaming-size.ts', 'voc-pcm-sample-rate.ts', 'wav-adm-import.ts', 'wav-adm-riff-sequence.ts',
	'wav-adpcm-source-geometry.ts', 'wav-ds64.js', 'wav-import-io.ts', 'wav-import.js',
	'wav-metadata-finalize.ts', 'wav-opaque-chunks.ts', 'wav-pcm-chunk-reader.ts', 'wav.js',
	'wave64-pcm-source-geometry.ts',
] as const;

test('WAV container codecs have exact foundational ownership independent of path separator', () => {
	assert.equal(CODEC_LEAVES.length, 35);
	for (const leaf of CODEC_LEAVES) {
		const path = `src/common/editor/${leaf}`;
		for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), OWNER, path);
			for (const foreign of [path + '.foreign', path.replace(/\.(?:js|ts)$/u, '-future.ts'), path.replace('editor/', 'editor/internal/')]) {
				assert.notEqual(chunkGroupForModulePath(foreign.replaceAll('/', separator)), OWNER, foreign);
			}
		}
	}
});

test('the actual WAV codec runtime closure contains only its finite codecs, neutral cancellation and existing XML vendors', () => {
	const allowed = new Set<string>(CODEC_LEAVES);
	const packages = new Set<string>();
	for (const leaf of CODEC_LEAVES) {
		const path = `${EDITOR_DIRECTORY}${leaf}`;
		const source = transformSync(readFileSync(path, 'utf8'), { loader: leaf.endsWith('.ts') ? 'ts' : 'js', format: 'esm' }).code;
		assert.doesNotMatch(source, /\bimport\s*\(/u, leaf);
		for (const specifier of staticRelativeDependencies(source)) {
			const target = resolveRelativeModule(path, specifier);
			assert.ok(target, `${leaf} imports unavailable ${specifier}`);
			const targetLeaf = relative(EDITOR_DIRECTORY, target).split(sep).join('/');
			assert.doesNotMatch(targetLeaf, /(?:^|\/)(?:controller|ui|storage)\//u, `${leaf} imports ${targetLeaf}`);
			assert.ok(allowed.has(targetLeaf) || targetLeaf === 'abort-race.ts', `${leaf} imports unrelated ${targetLeaf}`);
			assert.equal(chunkGroupForModulePath(target), targetLeaf === 'abort-race.ts' ? 'editor-neutral-foundations' : OWNER, targetLeaf);
		}
		for (const match of source.matchAll(/(?:\bfrom\s+|^import\s*)['"]([^'"]+)['"]/gmu)) {
			if (!match[1]!.startsWith('.')) packages.add(match[1]!);
		}
	}
	assert.deepEqual([...packages].sort(), ['fflate', 'saxes']);
});
