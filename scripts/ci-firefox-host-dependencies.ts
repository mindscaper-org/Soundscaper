/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const pinnedPlaywrightVersion = '1.62.1';
const outputLimit = 65_536;
const pulsePackages = ['pulseaudio', 'pulseaudio-utils'];
const packagePattern = /^[a-z0-9][a-z0-9+.-]*(?::[a-z][a-z0-9-]*)?$/u;

export interface DependencyResult {
	stdout: string;
	stderr: string;
	status: number | null;
	signal: string | null;
	error?: Error;
}

export interface DependencyCommand {
	executable: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
}

type CommandRunner = (command: DependencyCommand) => DependencyResult;

function requireCompleted(result: DependencyResult, label: string): void {
	if (result.error || result.signal || result.status === null) {
		throw new Error(`${label} did not complete: ${result.error?.message ?? result.signal ?? 'no exit status'}`);
	}
}

/** Parse data from the pinned Linux CLI. Never evaluate its output as a command. */
export function parseFirefoxDependencyInventory(result: DependencyResult): string[] {
	requireCompleted(result, 'Firefox dependency dry run');
	if (Buffer.byteLength(result.stdout) > outputLimit || result.stderr !== '') {
		throw new Error('Firefox dependency dry run produced unexpected or excessive output');
	}
	if (result.status === 0 && result.stdout === 'All system dependencies are installed.\n') return [];
	const header = /^Missing system dependencies \(([1-9]\d*)\):\n/u.exec(result.stdout);
	if (result.status !== 1 || !header || !result.stdout.endsWith('\n')) {
		throw new Error('Unsupported pinned Firefox dependency inventory');
	}
	const count = Number(header[1]);
	const lines = result.stdout.slice(header[0].length, -1).split('\n');
	if (count > 512 || lines.length !== count) throw new Error('Firefox dependency inventory count is invalid');
	const packages = lines.map(line => {
		const name = line.startsWith('  ') ? line.slice(2) : '';
		if (name.length > 256 || !packagePattern.test(name)) throw new Error('Unsafe Firefox dependency package name');
		return name;
	});
	if (new Set(packages).size !== count || [...packages].sort().some((name, index) => packages[index] !== name)) {
		throw new Error('Firefox dependency inventory must be sorted and unique');
	}
	return packages;
}

function readRecord(path: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Invalid dependency metadata: ${path}`);
	return parsed as Record<string, unknown>;
}

/** Match the installed CLI, its engine package and the committed lockfile before probing. */
export function resolvePinnedFirefoxCli(root: string): string {
	const require = createRequire(join(root, 'package.json'));
	const lock = readRecord(join(root, 'package-lock.json'));
	const packages = lock.packages;
	if (!packages || typeof packages !== 'object' || Array.isArray(packages)) throw new Error('Missing locked Playwright inventory');
	for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
		const installed = readRecord(require.resolve(`${name}/package.json`));
		const locked: unknown = (packages as Record<string, unknown>)[`node_modules/${name}`];
		if (installed.version !== pinnedPlaywrightVersion || !locked || typeof locked !== 'object'
			|| !('version' in locked) || locked.version !== pinnedPlaywrightVersion) {
			throw new Error(`Firefox dependency CLI must match locked Playwright ${pinnedPlaywrightVersion}: ${name}`);
		}
	}
	return join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
}

function execute(command: DependencyCommand): DependencyResult {
	const result = spawnSync(command.executable, command.args, {
		cwd: command.cwd, env: command.env, encoding: 'utf8', shell: false,
		stdio: command.executable === 'bash' ? 'inherit' : 'pipe',
		timeout: command.timeoutMs, maxBuffer: outputLimit, killSignal: 'SIGTERM',
	});
	return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status, signal: result.signal, ...(result.error ? { error: result.error } : {}) };
}

export function installFirefoxHostDependencies({
	root, run = execute, env = process.env, now = () => performance.now(),
}: { root: string; run?: CommandRunner; env?: NodeJS.ProcessEnv; now?: () => number }): { requestedPackages: string[] } {
	const started = now();
	if (!Number.isFinite(started) || started < 0) throw new Error('Firefox dependency budget requires a finite monotonic clock');
	let lastTime = started;
	const cli = resolvePinnedFirefoxCli(root);
	const commandEnv = { ...env, LC_ALL: 'C' };
	const invoke = (executable: string, args: string[], timeoutMs = 90_000, overrides: NodeJS.ProcessEnv = {}) => {
		const time = now();
		if (!Number.isFinite(time) || time < lastTime) throw new Error('Firefox dependency budget requires a finite monotonic clock');
		lastTime = time;
		const remainingMs = Math.floor(660_000 - (time - started));
		if (remainingMs <= 0) throw new Error('Firefox dependency budget exhausted');
		return run({ executable, args, cwd: root, env: { ...commandEnv, ...overrides }, timeoutMs: Math.min(timeoutMs, remainingMs) });
	};
	const inventory = () => parseFirefoxDependencyInventory(invoke(process.execPath, [cli, 'install-deps', '--dry-run', 'firefox']));
	const configured = (name: string): boolean => {
		const result = invoke('dpkg-query', ['--show', '--showformat=${db:Status-Status}', name], 15_000);
		requireCompleted(result, `Package status for ${name}`);
		if (result.status === 1 && result.stdout === '') return false;
		if (result.status !== 0 || result.stderr !== '' || ![
			'installed', 'not-installed', 'config-files', 'half-installed', 'unpacked',
			'half-configured', 'triggers-awaited', 'triggers-pending',
		].includes(result.stdout)) throw new Error(`Unexpected package status for ${name}`);
		return result.stdout === 'installed';
	};
	let missing = [...new Set([...inventory(), ...pulsePackages.filter(name => !configured(name))])].sort();
	const requestedPackages = new Set<string>();
	// The first bounded apt update can expose newer candidates absent from its
	// initial simulation. Reconcile that complete inventory once, then fail closed.
	for (let pass = 0; missing.length > 0 && pass < 2; pass++) {
		const packages = pass === 0 ? missing : [...new Set([...missing, ...pulsePackages])].sort();
		for (const name of packages) requestedPackages.add(name);
		const result = invoke('bash', [join(root, 'scripts/ci-apt-install.sh'), ...packages], 660_000, {
			CI_APT_REQUIRE_ALL: '1', CI_APT_TIMEOUT_SECONDS: '120', CI_APT_ATTEMPTS: '2', CI_APT_RETRY_DELAY_SECONDS: '5',
		});
		requireCompleted(result, 'Firefox dependency installation');
		if (result.status !== 0) throw new Error(`Firefox dependency installation failed (${result.status})`);
		missing = inventory();
	}
	if (requestedPackages.size === 0) missing = inventory();
	if (missing.length > 0) throw new Error(`Firefox still requires system dependencies: ${missing.join(', ')}`);
	for (const name of pulsePackages) if (!configured(name)) throw new Error(`Firefox audio package is not configured: ${name}`);
	return { requestedPackages: [...requestedPackages].sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const receipt = installFirefoxHostDependencies({ root: fileURLToPath(new URL('../', import.meta.url)) });
		console.log(`Verified Firefox host dependencies; requested packages: ${receipt.requestedPackages.join(', ') || 'none'}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
