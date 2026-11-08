/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';
import type { Plugin } from 'esbuild';

/** The bundled main reads its staged product metadata at launch. Repository
 * metadata belongs to the default checkout product and cannot be baked in. */
export function lightscaperDesktopProductMetadataPluginCurrentV1(repositoryRoot: string): Plugin {
	if (typeof repositoryRoot !== 'string' || !isAbsolute(repositoryRoot) || repositoryRoot.includes('\0')) {
		throw new TypeError('Lightscaper desktop source root must be absolute.');
	}
	const source = resolve(repositoryRoot, 'desktop/constants.js');
	const metadata = resolve(repositoryRoot, 'desktop/product.json');
	return {
		name: 'lightscaper-staged-product-metadata-v1',
		setup(build) {
			build.onResolve({ filter: /^\.\/product\.json$/ }, args => {
				if (args.importer !== source || resolve(args.resolveDir, args.path) !== metadata) return undefined;
				return { path: './product.json', external: true };
			});
		},
	};
}
