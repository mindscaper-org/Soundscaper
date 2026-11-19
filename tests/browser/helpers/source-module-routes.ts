/* SPDX-License-Identifier: AGPL-3.0-only */

import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

interface SourceModuleRoute {
	readonly body: string;
	readonly contentType: 'text/javascript';
}

/** Bundle real browser entry points and expose their shared chunks through Playwright routes. */
export async function bundleSourceModuleRoutes(
	sourceRoot: URL,
	routePrefix: string,
	entryPoints: readonly URL[],
): Promise<Map<string, SourceModuleRoute>> {
	const outdir = join(fileURLToPath(new URL('../../../', import.meta.url)), 'test-results', 'source-module-routes');
	const bundle = await build({
		entryPoints: entryPoints.map(entry => fileURLToPath(entry)),
		outbase: fileURLToPath(sourceRoot),
		outdir, bundle: true, splitting: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
		sourcemap: 'inline',
	});
	return new Map(bundle.outputFiles.map(file => {
		const path = relative(outdir, file.path).split(sep).join('/');
		return [`${routePrefix}/${path}`, { body: file.text, contentType: 'text/javascript' }];
	}));
}
