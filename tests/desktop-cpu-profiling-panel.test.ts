/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('Help opens the desktop CPU panel and real effect CPU is sampled independently', {
	skip: process.platform !== 'linux' || !process.env.DISPLAY ? 'Requires Electron and a display (use xvfb-run).' : false,
	timeout: 60000,
}, async context => {
	const temporary = await mkdtemp(join(tmpdir(), 'cpu-profiling-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	await build({ absWorkingDir: root, entryPoints: {
		renderer: 'tests/fixtures/cpu-profiling-desktop-renderer.tsx',
		'cpu-profile-worklet': 'src/common/editor/engine/cpu-profile-worklet.ts',
	}, outdir: temporary, bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
		define: { 'import.meta.env': '{"DEV":false,"PROD":false}' },
		alias: { '@soundscaper/design-system': join(root, 'vendor/audacity-design-system/components/src'),
			'@audacity-ui/core': join(root, 'vendor/audacity-design-system/core/src/index.ts'),
			'@audacity-ui/tokens': join(root, 'vendor/audacity-design-system/tokens/src/index.ts') },
		loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
		plugins: [{ name: 'unused-vite-urls', setup(builder) {
			builder.onResolve({ filter: /\?(worker&)?url$/ }, args => ({ path: args.path, namespace: 'unused-url' }));
			builder.onLoad({ filter: /.*/, namespace: 'unused-url' }, () => ({ contents: 'export default "/unused.js";' }));
		} }],
	});
	await build({ stdin: { resolveDir: root, contents: `
		import { contextBridge, ipcRenderer } from 'electron';
		import { createCpuProfilerPreload } from './desktop/cpu-profile-preload.ts';
		contextBridge.exposeInMainWorld('cpuProfiler', createCpuProfilerPreload(channel => ipcRenderer.invoke(channel)));
	` }, outfile: join(temporary, 'preload.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
	await writeFile(join(temporary, 'index.html'), '<html><head><link rel="stylesheet" href="/renderer.css"></head><body><script type="module" src="/renderer.js"></script></body></html>');
	await build({ stdin: { resolveDir: root, contents: `
		import { app, BrowserWindow, protocol, session, ipcMain } from 'electron';
		import { registerAppScheme, createProtocolHandler } from './desktop/protocol.js';
		import { APP_SCHEME, APP_ORIGIN } from './desktop/constants.js';
		import { registerCpuProfiler } from './desktop/cpu-profile-service.ts';
		registerAppScheme(protocol);
		void (async () => {
		await app.whenReady();
		await session.defaultSession.protocol.handle(APP_SCHEME, createProtocolHandler({
			rendererRoot: ${JSON.stringify(temporary)}, runtimeRoot: ${JSON.stringify(temporary)}, readCapabilities: { get() { return null; } },
		}));
		const window = new BrowserWindow({ webPreferences: { preload: ${JSON.stringify(join(temporary, 'preload.cjs'))}, contextIsolation: true, sandbox: true } });
		registerCpuProfiler({ handle: (channel, listener) => ipcMain.handle(channel, listener), windowFor: () => window, metrics: () => app.getAppMetrics(), mainPid: process.pid });
		await window.loadURL(APP_ORIGIN + '/');
		})().catch(error => { console.error(error); app.exit(1); });
	` }, outfile: join(temporary, 'main.mjs'), bundle: true, platform: 'node', format: 'esm', external: ['electron'] });
	const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
		typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
	const app = await _electron.launch({ timeout: 20000, executablePath: process.env.SCAPE_TEST_ELECTRON_EXECUTABLE ?? join(root, 'node_modules/electron/dist/electron'),
		args: ['--no-sandbox', '--disable-audio-output', '--autoplay-policy=no-user-gesture-required',
			`--user-data-dir=${join(temporary, 'profile')}`, join(temporary, 'main.mjs')], env: environment });
	context.after(() => app.close());
	const page = await app.firstWindow();
	const errors: string[] = [];
	page.on('pageerror', error => { errors.push(error.message); context.diagnostic(error.message); });
	page.on('console', message => { if (message.type() === 'error') context.diagnostic(message.text()); });
	await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
	await page.getByRole('menuitem', { name: 'CPU profiling', exact: true }).click();
	const panel = page.getByRole('dialog', { name: 'CPU profiling', exact: true });
	await expect(panel).toBeVisible();
	await page.getByRole('button', { name: 'Start audio', exact: true }).click();
	const effects = panel.getByRole('row').filter({ hasText: 'Voice' });
	await expect(effects).toHaveCount(3);
	for (const index of [0, 1]) await expect(effects.nth(index).getByRole('cell').first()).toHaveText(/\d.*%/, { timeout: 15000 });
	await expect(effects.nth(2)).toContainText('Bypassed');
	await expect(panel.getByRole('row').filter({ hasText: 'Basic editor' }).getByRole('cell').first()).toHaveText(/\d.*%/);
	await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.debugger.isAttached())).toBe(true);
	await panel.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(panel).toHaveCount(0);
	await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
	await page.getByRole('menuitem', { name: 'CPU profiling', exact: true }).click();
	await page.getByRole('button', { name: 'Start audio', exact: true }).click();
	await expect(effects.first().getByRole('cell').first()).toHaveText(/\d.*%/);
	await expect(panel.getByRole('alert')).toHaveCount(0);
	await panel.getByRole('button', { name: 'Close', exact: true }).click();
	await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.debugger.isAttached())).toBe(false);
	assert.deepEqual(errors, []);
});
