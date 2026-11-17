/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import { promisify } from 'node:util';
import { MANAGED_FEATURES, resolveManagedPolicy, type ManagedPolicy } from './managed-policy.ts';

interface QueryOptions { readonly timeout: number; readonly maxBuffer: number; readonly windowsHide: boolean; readonly encoding: 'utf8' }
interface Options {
	readonly platform?: string;
	readonly productId: string;
	readonly environment?: NodeJS.ProcessEnv;
	readonly execute?: (path: string, args: string[], options: QueryOptions) => Promise<{ stdout: string }>;
}
const executeFile = promisify(execFile);

/** Read local GPO registry material; do not contact a domain controller or run a shell command. */
export async function loadWindowsManagedPolicy({ platform = process.platform, productId, environment = process.env, execute = executeFile }: Options): Promise<ManagedPolicy> {
	if (!['soundscaper', 'framescaper'].includes(productId)) throw new TypeError('Unknown managed-policy product.');
	if (platform !== 'win32') return resolveManagedPolicy();
	const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT;
	if (!systemRoot || !win32.isAbsolute(systemRoot)) throw new Error('The Windows registry policy reader requires SystemRoot.');
	const product = productId === 'soundscaper' ? 'Soundscaper' : 'Framescaper';
	const script = registryScript(product);
	const { stdout } = await execute(win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
		['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
		{ timeout: 10_000, maxBuffer: 256 * 1024, windowsHide: true, encoding: 'utf8' });
	const data: unknown = JSON.parse(stdout.replace(/^\uFEFF/u, '').trim());
	if (!data || typeof data !== 'object' || !('machine' in data) || !('user' in data) || !('msi' in data)
		|| typeof data.msi !== 'boolean' || !isRecord(data.machine) || !isRecord(data.user)) throw new TypeError('Invalid Windows registry policy response.');
	return resolveManagedPolicy({ machine: data.machine, user: data.user, msi: data.msi });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function registryScript(product: string): string {
	return `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
function Read-Policy($hive) {
 $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, [Microsoft.Win32.RegistryView]::Registry64)
 try {
  $key = $base.OpenSubKey('Software\\Policies\\Mindscaper\\${product}')
  $result = @{}
  if ($null -ne $key) {
   try {
    foreach ($name in @(${MANAGED_FEATURES.map(name => `'${name}'`).join(',')},'LaunchPreferences')) {
     if ($key.GetValueNames() -contains $name) {
      $expected = if ($name -eq 'LaunchPreferences') { 'String' } else { 'DWord' }
      if ($key.GetValueKind($name).ToString() -ne $expected) { throw 'Invalid registry policy value type' }
      $result[$name] = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
     }
    }
   } finally { $key.Dispose() }
  }
  return $result
 } finally { $base.Dispose() }
}
$machine = Read-Policy ([Microsoft.Win32.RegistryHive]::LocalMachine)
$user = Read-Policy ([Microsoft.Win32.RegistryHive]::CurrentUser)
$base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
try {
 $key = $base.OpenSubKey('Software\\Mindscaper\\${product}\\Installation')
 $msi = $false
 if ($null -ne $key) { try { $msi = $key.GetValue('ManagedByWindowsInstaller', 0) -eq 1 } finally { $key.Dispose() } }
 @{ machine = $machine; user = $user; msi = [bool]$msi } | ConvertTo-Json -Compress -Depth 24
} finally { $base.Dispose() }
`;
}
