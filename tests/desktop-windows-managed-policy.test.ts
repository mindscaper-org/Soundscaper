/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, win32 } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import ts from 'typescript';
import { executeWindowsRegistryQuery, loadWindowsManagedPolicy } from '../desktop/windows-managed-policy.ts';

test('the registry subprocess receives EOF and can return both Unicode launch presets', async () => {
	const script = `
		const preset = JSON.stringify({
			schemaVersion: 1,
			editor: { workspace: { custom: [{ id: 'custom', name: '漢'.repeat(60_000), layout: {} }] } },
		});
		process.stdin.resume();
		process.stdin.once('end', () => {
			process.stdout.write(JSON.stringify({ machine: { LaunchPreferences: preset }, user: { LaunchPreferences: preset }, msi: false }));
		});
	`;
	const policy = await loadWindowsManagedPolicy({ platform: 'win32', productId: 'soundscaper', environment: { SystemRoot: 'C:\\Windows' },
		execute: (_path, _args, options) => executeWindowsRegistryQuery(process.execPath, ['-e', script], { ...options, timeout: 5_000 }) });
	assert.ok(policy.editorPreferences);
});

test('Packaged Electron completes concurrent Windows policy reads', { skip: process.platform !== 'win32' }, async context => {
	const electronPath: unknown = createRequire(import.meta.url)('electron');
	assert.ok(typeof electronPath === 'string');
	const root = await mkdtemp(join(tmpdir(), 'desktop-windows-policy-'));
	context.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
	const distribution = join(root, 'runtime');
	await cp(dirname(electronPath), distribution, { recursive: true });
	const executable = join(distribution, 'PolicyRead.exe');
	await rename(join(distribution, basename(electronPath)), executable);
	const application = join(distribution, 'resources', 'app');
	await mkdir(application);
	for (const name of ['managed-policy', 'windows-managed-policy']) {
		const fileName = `${name}.ts`;
		const source = await readFile(new URL(`../desktop/${fileName}`, import.meta.url), 'utf8');
		const { outputText } = ts.transpileModule(source, {
			fileName, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, rewriteRelativeImportExtensions: true },
		});
		await writeFile(join(application, `${name}.js`), outputText);
	}
	await writeFile(join(application, 'package.json'), JSON.stringify({ name: 'desktop-windows-policy', type: 'module', main: 'main.js' }));
	await writeFile(join(application, 'main.js'), `
		import { app } from 'electron';
		import { loadWindowsManagedPolicy } from './windows-managed-policy.js';
		async function run() {
			if (!app.isPackaged) throw new Error('The policy test must run as a packaged app.');
			if (!app.requestSingleInstanceLock()) throw new Error('Could not acquire the policy test profile.');
			await app.whenReady();
			const policy = await loadWindowsManagedPolicy({ productId: process.argv.at(-1) });
			console.log('policy-ready', process.arch, typeof policy.allows('OnlineFeaturesAllowed'));
			app.exit(0);
		}
		void run().catch(error => {
			console.error(error);
			app.exit(1);
		});
	`);
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	const launch = promisify(execFile);
	const reads = await Promise.allSettled(['soundscaper', 'framescaper'].map(product => {
		const child = launch(executable, [`--user-data-dir=${join(root, product)}`, product],
			{ env, cwd: root, windowsHide: true, timeout: 45_000 });
		child.child.stdin?.end();
		return child;
	}));
	for (const read of reads) {
		if (read.status === 'rejected') throw read.reason;
		assert.equal(read.value.stdout.trim(), `policy-ready ${process.arch} boolean`);
	}
});

test('Windows reads machine/user policy and MSI ownership through a bounded native registry query', async () => {
	const calls: unknown[][] = [];
	const policy = await loadWindowsManagedPolicy({ platform: 'win32', productId: 'framescaper', environment: { SystemRoot: 'C:\\Windows' },
		execute: async (...args) => { calls.push(args); return { stdout: JSON.stringify({ machine: { OnlineFeaturesAllowed: 0 }, user: {}, msi: true }) }; } });
	assert.equal(policy.msi, true);
	assert.equal(policy.allows('WebVcrAllowed'), false);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]![0], 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
	assert.equal((calls[0]![2] as { timeout: number }).timeout, 30_000);
	const args = calls[0]![1] as string[];
	assert.equal(args.at(-2), '-Command');
	const script = args.at(-1)!;
	assert.match(script, /Registry64/u);
	assert.match(script, /Software\\Policies\\Mindscaper\\Framescaper/u);
	assert.match(script, /ManagedByWindowsInstaller/u);
});

test('a registry query timeout reports the deadline instead of the command', async () => {
	const timedOut = Object.assign(new Error('Command failed: powershell.exe -Command payload'), { code: 'ETIMEDOUT' });
	await assert.rejects(loadWindowsManagedPolicy({ platform: 'win32', productId: 'soundscaper', environment: { SystemRoot: 'C:\\Windows' },
		execute: async () => { throw timedOut; } }), { message: 'The Windows registry policy query timed out after 30 seconds.' });
});

test('native Windows registry policy resolves scope and rejects a mistyped restriction', { skip: process.platform !== 'win32' }, async context => {
	const powershell = win32.join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
	async function run(script: string): Promise<void> {
		await executeWindowsRegistryQuery(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`$ErrorActionPreference='Stop'\n${script}`, 'utf16le').toString('base64')],
			{ timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true, encoding: 'utf8' });
	}
	const key = 'Software\\Policies\\Mindscaper\\Soundscaper';
	await run(`foreach ($hive in @([Microsoft.Win32.Registry]::LocalMachine,[Microsoft.Win32.Registry]::CurrentUser)) {
 $existing=$hive.OpenSubKey('${key}'); if ($null -ne $existing) { $existing.Dispose(); throw 'Test requires an unconfigured disposable Windows machine' }
}`);
	context.after(() => run(`foreach ($hive in @([Microsoft.Win32.Registry]::LocalMachine,[Microsoft.Win32.Registry]::CurrentUser)) { $hive.DeleteSubKeyTree('${key}', $false) }`));
	await run(`$machine=[Microsoft.Win32.Registry]::LocalMachine.CreateSubKey('${key}')
$user=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${key}')
try {
 $machine.SetValue('OnlineFeaturesAllowed',0,[Microsoft.Win32.RegistryValueKind]::DWord)
 $user.SetValue('OnlineFeaturesAllowed',1,[Microsoft.Win32.RegistryValueKind]::DWord)
 $machine.SetValue('LaunchPreferences','{"schemaVersion":1,"editor":{"appearance":{"theme":"dark"}}}')
 $user.SetValue('LaunchPreferences','{"schemaVersion":1,"editor":{"appearance":{"theme":"light"}}}')
} finally { $machine.Dispose(); $user.Dispose() }`);
	const policy = await loadWindowsManagedPolicy({ productId: 'soundscaper' });
	assert.equal(policy.allows('OnlineFeaturesAllowed'), false);
	assert.deepEqual(policy.editorPreferences, { appearance: { theme: 'dark' } });
	await run(`$key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('${key}', $true)
try { $key.DeleteValue('OnlineFeaturesAllowed') } finally { $key.Dispose() }`);
	assert.equal((await loadWindowsManagedPolicy({ productId: 'soundscaper' })).allows('OnlineFeaturesAllowed'), true);
	await run(`$key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('${key}', $true)
try { $key.SetValue('OnlineFeaturesAllowed','0',[Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }`);
	await assert.rejects(loadWindowsManagedPolicy({ productId: 'soundscaper' }));
});

test('missing policy is unrestricted, while read failures and malformed policy never silently enable networking', async () => {
	let invoked = false;
	const policy = await loadWindowsManagedPolicy({ platform: 'linux', productId: 'soundscaper', execute: async () => { invoked = true; throw new Error(); } });
	assert.equal(invoked, false);
	assert.equal(policy.allows('OnlineFeaturesAllowed'), true);
	const options = { platform: 'win32', productId: 'soundscaper', environment: { SystemRoot: 'C:\\Windows' } };
	await assert.rejects(loadWindowsManagedPolicy({ ...options, execute: async () => { throw new Error('registry unavailable'); } }), /registry/u);
	await assert.rejects(loadWindowsManagedPolicy({ ...options, execute: async () => ({ stdout: '{broken' }) }));
	assert.equal((await loadWindowsManagedPolicy({ ...options, execute: async () => ({ stdout: '{"machine":{},"user":{},"msi":false}' }) })).allows('OnlineFeaturesAllowed'), true);
});
