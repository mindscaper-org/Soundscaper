/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFileSync } from 'node:child_process';
import { win32 } from 'node:path';
import { MANAGED_FEATURES, resolveManagedPolicy, type ManagedPolicy } from './managed-policy.ts';

interface QueryOptions { readonly timeout: number; readonly maxBuffer: number; readonly windowsHide: boolean; readonly encoding: 'utf8' }
interface Options {
	readonly platform?: string;
	readonly productId: string;
	readonly environment?: NodeJS.ProcessEnv;
	readonly execute?: (path: string, args: string[], options: QueryOptions) => { stdout: string } | Promise<{ stdout: string }>;
}
const REGISTRY_QUERY_TIMEOUT_MS = 30_000;
const REGISTRY_LIST_TIMEOUT_MS = 3_000;
const MAXIMUM_REGISTRY_LIST_BYTES = 256 * 1024;
// Two 65,536-character presets can each expand to six JSON-escaped bytes per
// UTF-16 code unit, in addition to the fixed registry envelope.
const MAXIMUM_REGISTRY_OUTPUT_BYTES = 2 * 65_536 * 6 + 16 * 1024;

export function executeWindowsRegistryQuery(path: string, args: string[], options: QueryOptions): { stdout: string } {
	// Use the same synchronous transport as the Windows startup volume probe.
	return { stdout: execFileSync(path, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] }) };
}

/** Read local GPO registry material; do not contact a domain controller or run a shell command. */
export async function loadWindowsManagedPolicy({ platform = process.platform, productId, environment = process.env, execute = executeWindowsRegistryQuery }: Options): Promise<ManagedPolicy> {
	if (!['soundscaper', 'framescaper'].includes(productId)) throw new TypeError('Unknown managed-policy product.');
	if (platform !== 'win32') return resolveManagedPolicy();
	const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT;
	if (!systemRoot || !win32.isAbsolute(systemRoot)) throw new Error('The Windows registry policy reader requires SystemRoot.');
	const systemDirectory = win32.join(systemRoot, 'System32');
	const product = productId === 'soundscaper' ? 'Soundscaper' : 'Framescaper';
	if (await managedRegistryKeysAreAbsent(win32.join(systemDirectory, 'reg.exe'), product, execute)) return resolveManagedPolicy();
	const script = registryScript(product);
	let stdout: string;
	try {
		({ stdout } = await execute(win32.join(systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
			['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
			{ timeout: REGISTRY_QUERY_TIMEOUT_MS, maxBuffer: MAXIMUM_REGISTRY_OUTPUT_BYTES, windowsHide: true, encoding: 'utf8' }));
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ETIMEDOUT') {
			throw new Error(`The Windows registry policy query timed out after ${REGISTRY_QUERY_TIMEOUT_MS / 1000} seconds.`, { cause: error });
		}
		throw new Error('The Windows registry policy query failed.', { cause: error });
	}
	const data: unknown = JSON.parse(stdout.replace(/^\uFEFF/u, '').trim());
	if (!data || typeof data !== 'object' || !('machine' in data) || !('user' in data) || !('msi' in data)
		|| typeof data.msi !== 'boolean' || !isRecord(data.machine) || !isRecord(data.user)) throw new TypeError('Invalid Windows registry policy response.');
	return resolveManagedPolicy({ machine: data.machine, user: data.user, msi: data.msi });
}

/** Establish absence from successful parent listings. A failed query can also mean access was denied. */
async function managedRegistryKeysAreAbsent(executable: string, product: string, execute: NonNullable<Options['execute']>): Promise<boolean> {
	const machine = 'HKEY_LOCAL_MACHINE\\Software';
	const user = 'HKEY_CURRENT_USER\\Software';
	const policy = ['Policies', 'Mindscaper', product];
	const listings = new Map<string, Set<string>>();
	try {
		for (const [hive, segments] of [[machine, policy], [user, policy], [machine, ['Mindscaper', product, 'Installation']]] as const) {
			let parent: string = hive;
			for (const segment of segments) {
				let listed = listings.get(parent);
				if (!listed) {
					const { stdout } = await execute(executable, ['query', parent, '/reg:64'], {
						timeout: REGISTRY_LIST_TIMEOUT_MS, maxBuffer: MAXIMUM_REGISTRY_LIST_BYTES, windowsHide: true, encoding: 'utf8',
					});
					listed = new Set();
					const header = parent.toUpperCase();
					for (const line of stdout.split(/\r?\n/u)) {
						const entry = line.trim().toUpperCase();
						if (!entry || entry === header || /^[ \t]+\S.*[ \t]+REG_\w+(?:[ \t]|$)/u.test(line)) continue;
						if (!entry.startsWith(`${header}\\`)) return false;
						listed.add(entry);
					}
					listings.set(parent, listed);
				}
				const child = `${parent}\\${segment}`;
				if (!listed.has(child.toUpperCase())) break;
				if (segment === segments.at(-1)) return false;
				parent = child;
			}
		}
		return true;
	} catch {
		return false;
	}
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
