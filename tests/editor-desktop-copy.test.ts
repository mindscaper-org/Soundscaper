/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

import {
	createProductSubstitutionResolver,
	productStandInAliasesFor,
} from '../scripts/lib/product-aliases.mjs';
import type { EditorCopy } from '../src/common/i18n/editor-copy-inventory.ts';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('every product copy composition initializes with the shared Vamp parameter identity', async () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		for (const desktopCodecComposition of [false, true]) {
			const substitute = createProductSubstitutionResolver(repositoryRoot,
				productStandInAliasesFor({ productId, desktopCodecComposition }));
			const result = await build({
				entryPoints: [resolve(repositoryRoot, 'src/common/i18n/editor-copy-inventory.ts')],
				bundle: true, write: false, format: 'esm', platform: 'node',
				define: {
					__SCAPE_PRODUCT__: JSON.stringify(productId),
					__SCAPE_DESKTOP_RENDERER__: JSON.stringify(productId === 'soundscaper' && desktopCodecComposition),
				},
				plugins: [{
					name: 'production-product-substitutions',
					setup(builder) {
						builder.onResolve({ filter: /^\./ }, ({ path, importer }) => {
							const target = substitute(path, importer);
							return target === null ? undefined : { path: target };
						});
					},
				}],
			});
			const source = result.outputFiles[0]!.text;
			const inventory = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`) as {
				readonly EDITOR_ENGLISH_COPY: EditorCopy;
			};
			assert.equal(inventory.EDITOR_ENGLISH_COPY['ui.framescaperNative.ofxParameters'], 'Parameters');
			assert.equal(inventory.EDITOR_ENGLISH_COPY['ui.vamp.title'], 'Vamp Analyzer');
			if (productId === 'soundscaper' && desktopCodecComposition) {
				assert.equal(inventory.EDITOR_ENGLISH_COPY['ui.framescaperNative.ofxAuthor'], undefined);
			}
		}
	}
});
