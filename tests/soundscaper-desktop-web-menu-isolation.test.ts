/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

import { assertDesktopRendererProductIsolation }
	from '../scripts/lib/desktop-renderer-product-isolation.mjs';
import { createProductSubstitutionResolver, productStandInAliasesFor }
	from '../scripts/lib/product-aliases.mjs';
import { exposeWebDesktopCommands }
	from '../src/soundscaper/editor-web-desktop-command-menus.ts';

test('desktop Soundscaper preserves native menu commands without adding download offers', () => {
	let nativeCalls = 0;
	const nativeCommand = { id: 'native-effect-use', label: 'Audio plug-in effects',
		onClick: () => { nativeCalls++; } };
	const menus = exposeWebDesktopCommands([nativeCommand], {
		productId: 'soundscaper', locale: 'en', copy: {},
		onUnavailable: () => { assert.fail('Desktop commands must keep their native actions.'); },
	});
	assert.deepEqual(menus, [nativeCommand]);
	assert.equal(menus[0], nativeCommand);
	menus[0]?.onClick?.();
	assert.equal(nativeCalls, 1);
});

test('desktop Soundscaper web-command seam excludes Framescaper implementation from its menu bundle', async () => {
	const repositoryRoot = resolve(import.meta.dirname, '..');
	const resolveSubstitution = createProductSubstitutionResolver(repositoryRoot, productStandInAliasesFor({
		productId: 'soundscaper', desktopCodecComposition: true,
	}));
	const result = await build({
		stdin: {
			contents: "export { exposeWebDesktopCommands } from '../web-desktop-command-menus.ts';",
			resolveDir: resolve(repositoryRoot, 'src/common/editor/ui/workspace'),
			sourcefile: 'desktop-menu-entry.ts',
		},
		bundle: true,
		write: false,
		metafile: true,
		format: 'esm',
		platform: 'browser',
		plugins: [{
			name: 'product-substitutions',
			setup(plugin) {
				plugin.onResolve({ filter: /^\.\.?\// }, (args) => {
					const path = resolveSubstitution(args.path,
						args.importer || resolve(args.resolveDir, 'desktop-menu-entry.ts'));
					return path === null ? null : { path };
				});
			},
		}],
	});
	const modules = Object.fromEntries(Object.keys(result.metafile.inputs)
		.map(path => [resolve(repositoryRoot, path), {}]));
	assert.doesNotThrow(() => assertDesktopRendererProductIsolation({
		'assets/editor-shell.js': {
			type: 'chunk', fileName: 'assets/editor-shell.js', modules,
			code: result.outputFiles[0]?.text ?? '',
		},
	}, 'soundscaper'));
});
