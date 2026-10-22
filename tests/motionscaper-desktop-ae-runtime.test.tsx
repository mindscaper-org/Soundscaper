/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { installMotionscaperDesktopLaunch } from '../src/motionscaper/editor-desktop-launch.ts';
import type { MotionDesktopFiles } from '../src/motionscaper/desktop-file-contract.ts';
import type { MotionscaperDocumentSnapshot } from '../src/motionscaper/editor-document-session.ts';
import type { MotionscaperDocumentRuntimeProps } from '../src/common/editor/ui/motionscaper/MotionscaperDocumentRuntime.tsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const source of ['menu', 'native'] as const) test(`actual runtime holds warm launches throughout ${source} AE bridge lazy fallback until close`, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-native-ae-runtime-'));
	const require = createRequire(import.meta.url), repository = fileURLToPath(new URL('../', import.meta.url));
	let allowBridge = () => undefined as void;
	const gate = new Promise<void>(resolve => { allowBridge = resolve; });
	const bridge = join(directory, 'held-bridge.mjs');
	await writeFile(bridge, `import React from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};
		await globalThis.__motionNativeAeGate;
		export default function Bridge(props) { globalThis.__motionNativeAeProps = props;
		return React.createElement('div', {role:'dialog'}, props.copy.motionscaperAfterEffectsBridge); }`);
	const bundled = await build({ entryPoints: [join(repository, 'src/common/editor/ui/motionscaper/MotionscaperDocumentRuntime.tsx')],
		bundle: true, write: false, platform: 'node', format: 'esm', target: 'node26', jsx: 'automatic',
		loader: { '.css': 'empty', '.svg': 'text' },
		define: { __SCAPE_PRODUCT__: '"motionscaper"', __SCAPE_FRAMESCAPER_LINE__: '"successor"', 'import.meta.env.PROD': 'false', 'import.meta.env.DEV': 'false' },
		plugins: [{ name: 'held-bridge-import', setup(plugin) {
			plugin.onResolve({ filter: /^\.\/Motion.*Dialog\.tsx$/ }, args => ({
				path: args.path === './MotionAeBridgeDialog.tsx' ? bridge : join(repository, 'src/common/editor/ui/motionscaper', args.path), external: true,
			}));
			plugin.onResolve({ filter: /\.tsx?$/ }, args => args.kind === 'dynamic-import' ? { path: join(args.resolveDir, args.path), external: true } : undefined);
			plugin.onResolve({ filter: /^[^./]/ }, args => ({ path: require.resolve(args.path), external: true }));
		} }] });
	assert.ok(bundled.outputFiles[0]); const output = join(directory, 'runtime.mjs'); await writeFile(output, bundled.outputFiles[0].contents);
	const loaded = await import(pathToFileURL(output).href) as { default: React.ComponentType<MotionscaperDocumentRuntimeProps> };
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const names = ['React', 'indexedDB', 'IS_REACT_ACT_ENVIRONMENT', '__motionNativeAeGate', '__motionNativeAeProps'];
	const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
	for (const [name, value] of Object.entries({ React, indexedDB: createInstrumentedIndexedDB(), IS_REACT_ACT_ENVIRONMENT: true, __motionNativeAeGate: gate })) {
		Object.defineProperty(globalThis, name, { configurable: true, value });
	}
	const snapshots: MotionscaperDocumentSnapshot[] = []; let takes = 0, opened = 0, reads = 0, binds = 0, releases = 0, completed = 0;
	const request: MotionscaperDocumentRuntimeProps['request'] = source === 'menu' ? { id: 1, command: 'after-effects' } : {
		id: 1, command: 'open', nativeArchive: { name: 'Original.AEPX',
			input: createScapeArchiveByteSource({ size: 4096, maximumReadBytes: 4096, read: async () => { reads++; throw new Error('Adobe source must not be read.'); } }),
			bind: async () => { binds++; throw new Error('Adobe source must not bind.'); },
			release: async () => { assert.equal(snapshots.at(-1)?.busy, true, 'busy fence precedes capability release'); releases++; },
		}, onComplete: () => { completed++; },
	};
	const files: MotionDesktopFiles = { selectOpen: async () => null, read: async () => { throw new Error('No warm byte read.'); },
		release: async () => undefined, bindOpened: async () => { throw new Error('No warm binding.'); }, beginSave: async () => null,
		write: async () => undefined, commit: async () => { throw new Error('No save.'); }, cancel: async () => undefined };
	let installation: ReturnType<typeof installMotionscaperDesktopLaunch> | undefined;
	try {
		await act(async () => { root.render(<loaded.default copy={motionscaperCopy('en')} request={request}
			onChange={value => { snapshots.push(value); }} onProjectOpened={() => { throw new Error('The bridge must not open a project.'); }} />); });
		assert.equal(dom.container.textContent.includes('Working'), true);
		assert.equal(dom.container.querySelectorAll('[role="dialog"]').length, 0, 'the real lazy import remains unresolved');
		assert.equal(snapshots.at(-1)?.busy, true, 'bridge ownership must not depend on mounted dialog DOM');
		assert.equal(reads, 0); assert.equal(binds, 0); assert.equal(releases, source === 'native' ? 1 : 0); assert.equal(completed, releases);
		assert.equal(snapshots.at(-1)?.project, null); assert.equal(snapshots.at(-1)?.savedDigest, null);
		installation = installMotionscaperDesktopLaunch({ files,
			launch: { take: async () => { takes++; return takes === 1 ? { token: 'warm', name: 'warm.mscape', byteLength: 1 } : null; }, acknowledge: async () => undefined, onPending: () => () => undefined },
			canOpen: () => snapshots.at(-1)?.busy === false && dom.container.querySelectorAll('[role="dialog"]').length === 0,
			onOpen: async selected => { opened++; await selected.release(); }, onError: error => { throw error; } });
		assert.equal(takes, 0); assert.equal(opened, 0);
		await act(async () => { allowBridge(); await gate; });
		assert.equal(dom.container.querySelectorAll('[role="dialog"]').length, 1); installation.wake(); assert.equal(takes, 0);
		const props = Reflect.get(globalThis, '__motionNativeAeProps') as { initialAdobeName?: string; onClose(): void };
		assert.equal(props.initialAdobeName, source === 'native' ? 'Original.AEPX' : undefined);
		await act(async () => { props.onClose(); });
		assert.equal(snapshots.at(-1)?.busy, false); assert.equal(dom.container.querySelectorAll('[role="dialog"]').length, 0);
		installation.wake(); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(opened, 1);
	} finally {
		installation?.dispose(); allowBridge(); await gate;
		await act(async () => { root.unmount(); }); dom.restore();
		for (const name of names) { const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
		await rm(directory, { recursive: true, force: true });
	}
});
