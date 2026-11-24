/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { build } from 'esbuild';

import {
	absoluteSourceMapSources,
	sourceMapDirectoryFor,
} from './build-source-map-relocation.mjs';

export const DESKTOP_RENDERER_SMOKE_BUNDLE = 'desktop-renderer-smoke.js';

/** Build the packaged Framescaper renderer smoke as one inventoried static module. */
export async function buildDesktopRendererSmokeBundle({
	repositoryRoot,
	rendererRoot,
	productId,
	sourceMaps = false,
}) {
	const root = resolve(repositoryRoot);
	const outputRoot = resolve(rendererRoot);
	if (productId !== 'framescaper') {
		throw new TypeError('The renderer smoke bundle requires Framescaper.');
	}
	const entryPoint = resolve(root, 'desktop', 'renderer-smoke-runtime-framescaper.js');
	const outputPath = resolve(outputRoot, DESKTOP_RENDERER_SMOKE_BUNDLE);
	await build({
		absWorkingDir: root,
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		platform: 'browser',
		format: 'esm',
		target: 'chrome128',
		define: {
			__SCAPE_RENDERER_SMOKE_PRODUCT__: JSON.stringify(productId),
		},
		minifySyntax: true,
		sourcemap: sourceMaps ? 'external' : false,
		sourcesContent: sourceMaps,
		legalComments: 'inline',
		logLevel: 'silent',
	});
	let sourceMapPath = null;
	if (sourceMaps) {
		const emittedMap = `${outputPath}.map`;
		const parsed = JSON.parse(await readFile(emittedMap, 'utf8'));
		const normalized = absoluteSourceMapSources(parsed, dirname(emittedMap), root);
		const mapRoot = sourceMapDirectoryFor(outputRoot);
		await mkdir(mapRoot, { recursive: true });
		sourceMapPath = join(mapRoot, basename(emittedMap));
		await writeFile(sourceMapPath, JSON.stringify(normalized));
		await unlink(emittedMap);
	}
	return Object.freeze({ entryPoint, outputPath, sourceMapPath });
}
