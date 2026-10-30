/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

import { assertDesktopRendererProductIsolation }
	from '../scripts/lib/desktop-renderer-product-isolation.mjs';

test('Soundscaper linked-audio recovery keeps the shipped menu graph free of Framescaper implementation', async () => {
	const result = await build({
		entryPoints: [resolve(import.meta.dirname, '../src/soundscaper/editor-application-menu-product-runtime.js')],
		bundle: true,
		write: false,
		metafile: true,
		format: 'esm',
		platform: 'browser',
	});
	const modules = Object.fromEntries(Object.keys(result.metafile.inputs)
		.map(path => [resolve(path), {}]));
	assert.doesNotThrow(() => assertDesktopRendererProductIsolation({
		'assets/editor-shell.js': {
			type: 'chunk', fileName: 'assets/editor-shell.js', modules,
			code: result.outputFiles[0]?.text ?? '',
		},
	}, 'soundscaper'));
});
