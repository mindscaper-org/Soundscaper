/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { win32 } from 'node:path';
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

test('Windows PowerShell completes concurrent policy reads', { skip: process.platform !== 'win32' }, async () => {
	const policies = await Promise.all([
		loadWindowsManagedPolicy({ productId: 'soundscaper' }),
		loadWindowsManagedPolicy({ productId: 'framescaper' }),
	]);
	for (const policy of policies) assert.equal(typeof policy.allows('OnlineFeaturesAllowed'), 'boolean');
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
	const script = Buffer.from((calls[0]![1] as string[]).at(-1)!, 'base64').toString('utf16le');
	assert.match(script, /Registry64/u);
	assert.match(script, /Software\\Policies\\Mindscaper\\Framescaper/u);
	assert.match(script, /ManagedByWindowsInstaller/u);
});

test('a registry query timeout reports the deadline instead of the encoded command', async () => {
	const timedOut = Object.assign(new Error('Command failed: powershell.exe -EncodedCommand payload'), { killed: true, signal: 'SIGTERM', code: null });
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
