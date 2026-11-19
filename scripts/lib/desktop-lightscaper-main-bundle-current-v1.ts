/* SPDX-License-Identifier: AGPL-3.0-only */

import { join } from 'node:path';
import { build, type Plugin } from 'esbuild';
import { lightscaperDesktopProductMetadataPluginCurrentV1 } from './desktop-lightscaper-product-metadata-plugin-current-v1.ts';

/** Smoke automation is statically bundled and invoked only by the paired
 * main-process CLI authority. It adds no preload or renderer filesystem API. */
export async function bundleLightscaperDesktopMainCurrentV1(repositoryRoot: string, appRoot: string): Promise<void> {
	const renderer = await build({
		absWorkingDir: repositoryRoot, entryPoints: ['desktop/lightscaper-managed-smoke-renderer-current-v1.ts'],
		bundle: true, platform: 'browser', target: 'es2022', format: 'iife',
		globalName: 'LightscaperManagedSmokeCurrentV1', write: false,
	});
	const script = renderer.outputFiles[0]?.text;
	if (!script || renderer.outputFiles.length !== 1 || script.length > 8 * 1024 ** 2) throw new Error('Lightscaper smoke renderer closure is invalid.');
	const scriptPath = join(repositoryRoot, 'desktop/lightscaper-managed-smoke-renderer-script-current-v1.ts');
	const staticSmoke: Plugin = {
		name: 'lightscaper-static-managed-smoke-v1',
		setup(producer) {
			producer.onLoad({ filter: /lightscaper-managed-smoke-renderer-script-current-v1\.ts$/ }, args => args.path === scriptPath
				? { contents: `export const LIGHTSCAPER_MANAGED_SMOKE_RENDERER_SCRIPT_CURRENT_V1 = ${JSON.stringify(script)};`, loader: 'ts' }
				: undefined);
		},
	};
	await build({
		absWorkingDir: repositoryRoot, entryPoints: ['desktop/lightscaper-main-current-v1.ts'],
		outfile: join(appRoot, 'desktop/main.mjs'), bundle: true, platform: 'node', target: 'node26', format: 'esm',
		external: ['electron', 'electron/main', 'electron/renderer'],
		plugins: [lightscaperDesktopProductMetadataPluginCurrentV1(repositoryRoot), staticSmoke],
	});
	await build({
		absWorkingDir: repositoryRoot, entryPoints: ['desktop/lightscaper-preload-current-v1.ts'],
		outfile: join(appRoot, 'desktop/preload.cjs'), bundle: true, platform: 'node', target: 'es2022', format: 'cjs',
		external: ['electron', 'electron/main', 'electron/renderer'],
	});
}
