/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'src/soundscaper/ui');
const destination = resolve(root, '.desktop-build/tracktion-editor');
await mkdir(destination, { recursive: true });
await build({
	absWorkingDir: root,
	entryPoints: [resolve(source, 'tracktion-editor-entry.tsx')],
	outfile: resolve(destination, 'editor.js'),
	platform: 'browser',
	format: 'esm',
	jsx: 'automatic',
	bundle: true,
	minify: true,
});
await Promise.all([
	copyFile(resolve(source, 'tracktion-editor.html'), resolve(destination, 'index.html')),
	copyFile(resolve(source, 'tracktion-editor.css'), resolve(destination, 'editor.css')),
]);
