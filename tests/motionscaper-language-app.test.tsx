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
import { bundledSiteCopyForLocale } from '../src/common/i18n/site-copy.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

type Probe = { readonly identity: object; readonly value: string; edit(value: string): void;
	readonly props: { locale: string; copy: Readonly<Record<string, string>>; onLocaleChange(value: string): Promise<void> } };

test('real App and Motion Bootstrap publish persisted locale in place without remounting the document owner', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-app-locale-'));
	const repository = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url);
	const bundled = await build({ entryPoints: [join(repository, 'src/common/site/App.jsx')], bundle: true, write: false,
		platform: 'node', format: 'esm', target: 'node26', loader: { '.css': 'empty', '.svg': 'text' },
		define: { __SCAPE_PRODUCT__: '"motionscaper"', __SCAPE_FRAMESCAPER_LINE__: '"successor"', 'import.meta.env.PROD': 'false', 'import.meta.env.DEV': 'false' },
		plugins: [{ name: 'locale-reconciliation-owner', setup(plugin) {
			plugin.onResolve({ filter: /MotionscaperShell\.tsx$/ }, () => ({ path: 'retained-shell', namespace: 'locale-test' }));
			plugin.onLoad({ filter: /.*/, namespace: 'locale-test' }, () => ({ loader: 'jsx', contents:
				`import React, {useState} from 'react'; export default function Shell(props) {
				const [identity] = useState(() => ({})); const [value, edit] = useState('draft');
				globalThis.__motionLocaleProbe = {props, identity, value, edit};
				return <div data-retained-owner>{props.copy.motionscaperFileMenu}</div>; }` }));
			plugin.onResolve({ filter: /^[^./]/ }, args => ({ path: require.resolve(args.path), external: true }));
		} }] });
	const path = join(directory, 'app.mjs'); assert.ok(bundled.outputFiles[0]); await writeFile(path, bundled.outputFiles[0].contents);
	const loaded = await import(pathToFileURL(path).href) as { default: React.ComponentType<{ route: object }> };
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const scope = globalThis as typeof globalThis & { __motionLocaleProbe?: Probe; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const names = ['React', 'scapeDesktop', 'MutationObserver', '__motionLocaleProbe', 'IS_REACT_ACT_ENVIRONMENT'];
	const prior = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
	let resolve!: (locale: string) => void, reject!: (error: Error) => void;
	const calls: string[] = []; let pending = Promise.resolve('en');
	const probe = () => { assert.ok(scope.__motionLocaleProbe); return scope.__motionLocaleProbe; };
	const doc = document as unknown as { documentElement: typeof dom.container };
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	Object.defineProperty(globalThis, 'scapeDesktop', { configurable: true, value: { v1: { motionLocale: { set: (locale: string) => { calls.push(locale); return pending; } } } } });
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	try {
		await act(async () => { root.render(<loaded.default route={{ desktop: true, embedded: true, productId: 'motionscaper', locale: 'en', direction: 'ltr' }} />); });
		assert.equal(probe().props.locale, 'en'); const identity = probe().identity;
		await act(async () => { probe().edit('dirty project / undo history / native binding'); });
		pending = new Promise<string>((accept, refuse) => { resolve = accept; reject = refuse; });
		let changing!: Promise<void>;
		await act(async () => { changing = probe().props.onLocaleChange('de'); await Promise.resolve(); });
		assert.equal(probe().props.locale, 'en'); assert.equal(probe().identity, identity);
		await act(async () => { resolve('de'); await changing; });
		assert.equal(probe().props.locale, 'de'); assert.equal(probe().props.copy.motionscaperFileMenu, 'Datei');
		assert.equal(probe().props.copy.loading, bundledSiteCopyForLocale('de').loading, 'site fallback must change with product copy');
		assert.equal(Reflect.get(doc.documentElement, 'lang'), 'de'); assert.equal(Reflect.get(doc.documentElement, 'dir'), 'ltr');
		assert.equal(probe().identity, identity); assert.equal(probe().value, 'dirty project / undo history / native binding');
		pending = new Promise<string>((accept, refuse) => { resolve = accept; reject = refuse; });
		await act(async () => { changing = probe().props.onLocaleChange('ar'); await Promise.resolve(); });
		await act(async () => { reject(new Error('disk full')); await assert.rejects(changing, /disk full/u); });
		assert.equal(probe().props.locale, 'de'); assert.equal(probe().identity, identity);
		pending = Promise.resolve('ar'); await act(async () => { await probe().props.onLocaleChange('ar'); });
		assert.equal(Reflect.get(doc.documentElement, 'dir'), 'rtl'); assert.equal(probe().identity, identity);
		assert.deepEqual(calls, ['de', 'ar', 'ar']);
	} finally {
		await act(async () => { root.unmount(); }); dom.restore();
		for (const [name, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
		await rm(directory, { recursive: true, force: true });
	}
});
