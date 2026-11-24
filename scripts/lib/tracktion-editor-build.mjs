/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const source = resolve(root, 'src/soundscaper/ui');

export async function buildTracktionEditor(destination, browser = false) {
	await mkdir(destination, { recursive: true });
	await Promise.all([
		build({
			absWorkingDir: root,
			entryPoints: [resolve(source, browser ? 'tracktion-web-entry.tsx' : 'tracktion-editor-entry.tsx')],
			outfile: resolve(destination, 'editor.js'),
			platform: 'browser',
			format: 'esm',
			jsx: 'automatic',
			bundle: true,
			minify: true,
			loader: { '.css': 'empty' },
		}),
		copyFile(resolve(source, 'tracktion-editor.html'), resolve(destination, 'index.html')),
		copyFile(resolve(source, 'tracktion-editor.css'), resolve(destination, 'editor.css')),
		...(browser ? [build({
			entryPoints: [resolve(root, 'src/soundscaper/tracktion-audio-worklet.ts')],
			outfile: resolve(destination, 'tracktion-audio-worklet.js'),
			platform: 'browser', format: 'iife', bundle: true, minify: true,
		})] : []),
	]);
}

export async function buildTracktionProjectWorker(destination) {
	await build({
		entryPoints: [resolve(root, 'native/soundscaper-tracktion/wasm/tracktion-project-worker.ts')],
		outfile: resolve(destination, 'tracktion-project-worker.js'),
		platform: 'browser',
		format: 'iife',
		bundle: true,
	});
}
