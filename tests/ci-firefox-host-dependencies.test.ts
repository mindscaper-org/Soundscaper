/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
	installFirefoxHostDependencies,
	parseFirefoxDependencyInventory,
	resolvePinnedFirefoxCli,
	type DependencyCommand,
	type DependencyResult,
} from '../scripts/ci-firefox-host-dependencies.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const installed = 'All system dependencies are installed.\n';
// Captured from this lockfile's Playwright 1.62.1 Linux CLI, not a shell command.
const actualPinnedInventory = `Missing system dependencies (10):
  gir1.2-glib-2.0
  gir1.2-glib-2.0-dev
  libgirepository-2.0-0
  libglib2.0-0t64
  libglib2.0-bin
  libglib2.0-data
  libglib2.0-dev
  libglib2.0-dev-bin
  xserver-common
  xvfb
`;
// These six upgrade names are the actual f39 hosted post-refresh failure.
const postRefreshUpgradeInventory = `Missing system dependencies (6):
  gir1.2-glib-2.0
  libglib2.0-0t64
  libglib2.0-bin
  libglib2.0-data
  xserver-common
  xvfb
`;

function result(stdout: string, status = 0): DependencyResult {
	return { stdout, stderr: '', status, signal: null };
}

test('the pinned Linux dry run inventory retains every package including proposed upgrades', () => {
	assert.deepEqual(parseFirefoxDependencyInventory(result(actualPinnedInventory, 1)), [
		'gir1.2-glib-2.0', 'gir1.2-glib-2.0-dev', 'libgirepository-2.0-0',
		'libglib2.0-0t64', 'libglib2.0-bin', 'libglib2.0-data', 'libglib2.0-dev',
		'libglib2.0-dev-bin', 'xserver-common', 'xvfb',
	]);
	assert.deepEqual(parseFirefoxDependencyInventory(result(installed)), []);
});

test('dependency inventories refuse shell text, option injection and noncanonical package lists', () => {
	for (const stdout of [
		'sudo apt-get install xvfb\n',
		'Missing system dependencies (1):\n  --allow-unauthenticated\n',
		'Missing system dependencies (1):\n  xvfb;touch /tmp/unsafe\n',
		'Missing system dependencies (1):\n  $(touch /tmp/unsafe)\n',
		'Missing system dependencies (2):\n  xvfb\n',
		'Missing system dependencies (2):\n  xvfb\n  xvfb\n',
		'Missing system dependencies (2):\n  xvfb\n  libasound2\n',
		'Missing system dependencies (0):\n',
		'Missing system dependencies (01):\n  xvfb\n',
		'Missing system dependencies (513):\n  xvfb\n',
		'Missing system dependencies (1):\n  xvfb\nwarning\n',
		'Missing system dependencies (1):\n  xvfb',
		'Missing system dependencies (1):\n  xvfb\r\n',
		'Missing system dependencies (1):\n  /tmp/package.deb\n',
		`Missing system dependencies (1):\n  ${'a'.repeat(257)}\n`,
		'a'.repeat(65_537),
	]) assert.throws(() => parseFirefoxDependencyInventory(result(stdout, 1)), stdout.slice(0, 90));
});

test('dependency inventories require the exact successful or missing exit status and empty stderr', () => {
	for (const candidate of [
		result(installed, 1), result(actualPinnedInventory), result(actualPinnedInventory, 2),
		{ ...result(installed), signal: 'SIGTERM', status: null },
		{ ...result(installed), error: new Error('timeout') },
		{ ...result(installed), stderr: 'unexpected warning\n' },
	]) assert.throws(() => parseFirefoxDependencyInventory(candidate));
});

test('the CLI identity is authenticated against the installed package and committed lockfile', () => {
	assert.match(resolvePinnedFirefoxCli(root), /node_modules\/@playwright\/test\/cli\.js$/u);
});

test('a different installed or locked Playwright version refuses the dependency probe', () => {
	const fixture = mkdtempSync(join(tmpdir(), 'firefox-dependency-pin-'));
	try {
		writeFileSync(join(fixture, 'package.json'), '{}');
		const packages: Record<string, { version: string }> = {};
		for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
			const path = join(fixture, 'node_modules', name);
			mkdirSync(path, { recursive: true });
			writeFileSync(join(path, 'package.json'), JSON.stringify({ version: '1.62.1' }));
			packages[`node_modules/${name}`] = { version: '1.62.1' };
		}
		writeFileSync(join(fixture, 'package-lock.json'), JSON.stringify({ packages }));
		assert.match(resolvePinnedFirefoxCli(fixture), /cli\.js$/u);
		writeFileSync(join(fixture, 'node_modules/playwright-core/package.json'), '{"version":"1.62.0"}');
		assert.throws(() => resolvePinnedFirefoxCli(fixture), /must match locked/u);
		writeFileSync(join(fixture, 'node_modules/playwright-core/package.json'), '{"version":"1.62.1"}');
		packages['node_modules/playwright-core'] = { version: '1.62.0' };
		writeFileSync(join(fixture, 'package-lock.json'), JSON.stringify({ packages }));
		assert.throws(() => resolvePinnedFirefoxCli(fixture), /must match locked/u);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

function harness(responses: DependencyResult[]) {
	const calls: DependencyCommand[] = [];
	return {
		calls,
		run(command: DependencyCommand): DependencyResult {
			calls.push(command);
			const next = responses.shift();
			assert.ok(next, `unexpected command ${command.executable} ${command.args.join(' ')}`);
			return next;
		},
	};
}

test('fresh Firefox dependencies and Pulse packages use one bounded structured installation', () => {
	const h = harness([
		result(actualPinnedInventory, 1), result('', 1), result('config-files'),
		result(''), result(installed), result('installed'), result('installed'),
	]);
	const receipt = installFirefoxHostDependencies({ root, run: h.run, env: { PATH: '/verified/bin' } });
	assert.equal(h.calls.length, 7);
	assert.equal(h.calls[0]?.executable, process.execPath);
	assert.deepEqual(h.calls[0]?.args.slice(1), ['install-deps', '--dry-run', 'firefox']);
	const install = h.calls[3];
	assert.ok(install);
	assert.equal(install.executable, 'bash');
	assert.match(install.args[0] ?? '', /scripts\/ci-apt-install\.sh$/u);
	assert.deepEqual(install.args.slice(1), [...parseFirefoxDependencyInventory(result(actualPinnedInventory, 1)), 'pulseaudio', 'pulseaudio-utils'].sort());
	assert.equal(install.env.CI_APT_REQUIRE_ALL, '1');
	assert.equal(install.env.CI_APT_TIMEOUT_SECONDS, '120');
	assert.equal(install.env.CI_APT_ATTEMPTS, '2');
	assert.equal(install.env.PATH, '/verified/bin');
	assert.ok(install.timeoutMs > 0 && install.timeoutMs <= 660_000);
	assert.deepEqual(receipt.requestedPackages, install.args.slice(1));
	assert.ok(h.calls.every(call => call.env.LC_ALL === 'C'));
});

test('a fully configured runner does no apt work and still proves its final dependency state', () => {
	const h = harness([result(installed), result('installed'), result('installed'), result(installed), result('installed'), result('installed')]);
	assert.deepEqual(installFirefoxHostDependencies({ root, run: h.run }).requestedPackages, []);
	assert.ok(h.calls.every(call => call.executable !== 'bash'));
});

test('an unresolved post-install inventory or unconfigured Pulse package fails before browser verification', () => {
	const unresolved = harness([result(actualPinnedInventory, 1), result('installed'), result('installed'), result(''), result(postRefreshUpgradeInventory, 1), result(''), result(postRefreshUpgradeInventory, 1)]);
	assert.throws(() => installFirefoxHostDependencies({ root, run: unresolved.run }), /still requires/u);
	assert.equal(unresolved.calls.filter(call => call.executable === 'bash').length, 2, 'a third unresolved inventory must not start a third install');
	const pulse = harness([result(installed), result('installed'), result('unpacked'), result(''), result(installed), result('installed'), result('half-configured')]);
	assert.throws(() => installFirefoxHostDependencies({ root, run: pulse.run }), /not configured/u);
});

test('an installation failure or unsupported dry run cannot advance to a successful postcondition', () => {
	const failed = harness([result(actualPinnedInventory, 1), result('installed'), result('installed'), result('', 100)]);
	assert.throws(() => installFirefoxHostDependencies({ root, run: failed.run }), /installation failed/u);
	assert.equal(failed.calls.length, 4);
	const malformed = harness([result('sudo apt-get install xvfb\n', 1)]);
	assert.throws(() => installFirefoxHostDependencies({ root, run: malformed.run }));
	assert.equal(malformed.calls.length, 1);
	const packageStatus = harness([result(installed), result('unknown-dpkg-status')]);
	assert.throws(() => installFirefoxHostDependencies({ root, run: packageStatus.run }), /Unexpected package status/u);
});


test('a stale apt catalog reconciles all six newly exposed upgrades in one final complete pass', () => {
	const h = harness([
		result('Missing system dependencies (1):\n  fonts-freefont-ttf\n', 1), result('', 1), result('', 1),
		result(''), result(postRefreshUpgradeInventory, 1), result(''),
		result(installed), result('installed'), result('installed'),
	]);
	let clock = 0;
	const receipt = installFirefoxHostDependencies({ root, now: () => clock, run: command => {
		const response = h.run(command);
		if (command.executable === 'bash') clock += 100_000;
		return response;
	} });
	const installs = h.calls.filter(call => call.executable === 'bash');
	assert.equal(installs.length, 2);
	assert.deepEqual(installs[0]?.args.slice(1), ['fonts-freefont-ttf', 'pulseaudio', 'pulseaudio-utils']);
	assert.deepEqual(installs[1]?.args.slice(1), [...parseFirefoxDependencyInventory(result(postRefreshUpgradeInventory, 1)), 'pulseaudio', 'pulseaudio-utils'].sort());
	assert.ok(installs.every(call => call.env.CI_APT_REQUIRE_ALL === '1'));
	assert.deepEqual(installs.map(call => call.timeoutMs), [660_000, 560_000]);
	assert.deepEqual(receipt.requestedPackages, [...new Set(installs.flatMap(call => call.args.slice(1)))].sort());
	assert.equal(h.calls.length, 9);
});

test('one shared finite budget clamps every probe and refuses work after exhaustion', () => {
	const h = harness([result(installed), result('installed')]);
	let clock = 0;
	assert.throws(() => installFirefoxHostDependencies({ root, now: () => clock, run: command => {
		const response = h.run(command);
		clock = h.calls.length === 1 ? 650_000 : 660_001;
		return response;
	} }), /budget exhausted/u);
	assert.equal(h.calls.length, 2);
	assert.deepEqual(h.calls.map(call => call.timeoutMs), [90_000, 10_000]);
	assert.ok(h.calls.every(call => call.executable !== 'bash'));
	for (const invalid of [NaN, Infinity, -1]) {
		assert.throws(() => installFirefoxHostDependencies({ root, now: () => invalid, run: h.run }), /finite monotonic clock/u);
	}
	let ticks = 0;
	assert.throws(() => installFirefoxHostDependencies({ root, now: () => ticks++ === 0 ? 10 : 9, run: h.run }), /finite monotonic clock/u);
	assert.equal(h.calls.length, 2);
});
