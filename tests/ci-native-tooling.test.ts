/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import { selectDesktopNightlyTestTargets } from '../scripts/lib/desktop-nightly-tests-target-matrix.mjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { load } = require('js-yaml') as { load: (source: string) => unknown };

function record(value: unknown): Record<string, unknown> {
	assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

function dependencyInstallation(step: Record<string, unknown>): boolean {
	return step.uses === './.github/actions/verified-node-dependencies'
		|| (typeof step.run === 'string'
			&& step.run.split(/\r?\n/u).some((line) => line.trim() === 'npm ci'));
}

test('every ARM runner installs native Node before installing dependencies', () => {
	let checked = 0;
	for (const name of readdirSync(resolve(root, '.github/workflows'))) {
		if (!name.endsWith('.yml')) continue;
		const workflow = record(load(readFileSync(resolve(root, '.github/workflows', name), 'utf8')));
		for (const [id, value] of Object.entries(record(workflow.jobs))) {
			const job = record(value);
			if (!job.strategy) continue;
			const matrix = record(record(job.strategy).matrix);
			const rows = Array.isArray(matrix.include) ? matrix.include
				: Array.isArray(matrix.target) ? matrix.target : [];
			for (const value of rows) {
				if (typeof value === 'string') continue;
				const row = record(value);
				if (row.arch !== 'arm64' && !String(row.target).endsWith('-arm64')) continue;
				// Publishing an ARM archive does not execute its payload on the runner.
				const runner = row.runner ?? job['runs-on'];
				if (!String(runner).endsWith('-arm') && runner !== 'macos-15') continue;
				assertNativeArmSetup(job, row,
					Array.isArray(matrix.include) ? 'matrix' : 'matrix.target', `${name}/${id}`);
				checked += 1;
			}
		}
	}
	assert.ok(checked >= 15);
});

test('helper-backed nightly and AI asset jobs use native Node and tools', () => {
	for (const row of selectDesktopNightlyTestTargets('all')) {
		assert.equal(row.node_arch, row.arch);
	}
	for (const name of ['desktop-nightly-tests.yml', 'update-ai-assets.yml']) {
		const workflow = record(load(readFileSync(resolve(root, '.github/workflows', name), 'utf8')));
		const jobs = record(workflow.jobs);
		const job = record(Object.values(jobs).find((value) =>
			record(value)['runs-on'] === '${{ matrix.target.runner }}'));
		const steps = job.steps as Record<string, unknown>[];
		const setup = steps.findIndex((step) => step.uses === './.github/actions/setup-native-tooling');
		assert.ok(setup >= 0 && setup < steps.findIndex(dependencyInstallation));
	}
});

test('Windows media and OpenFX activate native compiler hosts without replacing native Ninja', () => {
	for (const name of ['framescaper-media-host-native-build.yml', 'framescaper-openfx-native-build.yml']) {
		const source = readFileSync(resolve(root, '.github/workflows', name), 'utf8');
		assert.match(source, /-host_arch=\$env:FRAMESCAPER_VS_ARCH/u);
		assert.doesNotMatch(source, /choco install[^\n]*\bninja\b/u);
	}
	const media = readFileSync(resolve(root, '.github/workflows/framescaper-media-host-native-build.yml'), 'utf8');
	assert.match(media, /windows-media-tools: 'true'/u);
	const workflow = record(load(media));
	const steps = Object.values(record(workflow.jobs))
		.flatMap(job => record(job).steps as Record<string, unknown>[]);
	const mediaTools = steps.find(step => typeof step.run === 'string'
		&& /^choco install make pkgconfiglite\b/u.test(step.run));
	assert.ok(mediaTools, 'the x64 Windows media build tools are installed');
	assert.equal(mediaTools.if, "runner.os == 'Windows' && runner.arch != 'ARM64'");
	const action = readFileSync(resolve(root, '.github/actions/setup-native-tooling/action.yml'), 'utf8');
	assert.match(action, /-arch=arm64 -host_arch=arm64/u);
	assert.match(action, /assertNativeWindowsExecutable\(readFileSync\(process\.argv\[1\]\), "MSVC compiler"\)/u);
});

function assertNativeArmSetup(
	job: Record<string, unknown>,
	row: Record<string, unknown>,
	matrixBinding: 'matrix' | 'matrix.target',
	label: string,
): void {
	assert.ok(Array.isArray(job.steps), `${label} steps`);
	const steps = job.steps.map(record);
	const node = steps.findIndex((step) => typeof step.uses === 'string'
		&& step.uses.startsWith('actions/setup-node@'));
	const setup = steps.findIndex((step) => step.uses === './.github/actions/setup-native-tooling');
	const install = steps.findIndex(dependencyInstallation);
	assert.ok(node >= 0 && node < setup && setup < install,
		`${label} native Node/tools before npm ci or verified dependency reuse`);
	const architecture = record(steps[node].with).architecture;
	const field = (['node_arch', 'arch'] as const).find((key) => (
		architecture === '${{ ' + matrixBinding + '.' + key + ' }}'
	));
	assert.ok(field, `${label} Node architecture binding`);
	assert.equal(row[field], 'arm64', `${label} Node architecture`);
	if (row.tooling_node_arch) {
		assert.equal(row.tooling_node_arch, 'arm64', `${label} npm architecture`);
	}
}

function nativeArmSteps(architecture: string, install = 'npm ci'): Record<string, unknown>[] {
	return [
		{ uses: 'actions/setup-node@395ad3262231945c25e8478fd5baf05154b1d79f', with: { architecture } },
		{ uses: './.github/actions/setup-native-tooling' },
		{ run: install },
	];
}

void test('native ARM guard follows the actual matrix binding through guarded npm ci blocks', () => {
	const guarded = "npm ci\nif ($LASTEXITCODE -ne 0) { throw 'Locked dependency installation failed.' }\n";
	assertNativeArmSetup({ steps: nativeArmSteps('${{ matrix.arch }}', guarded) },
		{ arch: 'arm64' }, 'matrix', 'guarded flat architecture');
	assertNativeArmSetup({ steps: nativeArmSteps('${{ matrix.node_arch }}') },
		{ node_arch: 'arm64' }, 'matrix', 'flat Node architecture');
	assertNativeArmSetup({ steps: nativeArmSteps('${{ matrix.target.node_arch }}') },
		{ node_arch: 'arm64' }, 'matrix.target', 'nested Node architecture');
});

void test('native ARM guard rejects comment and echo text as dependency installation', () => {
	for (const text of ['# npm ci', 'echo "npm ci"', 'Write-Output "npm ci"']) {
		assert.throws(() => assertNativeArmSetup(
			{ steps: nativeArmSteps('${{ matrix.arch }}', text) }, { arch: 'arm64' }, 'matrix', text,
		), /native Node\/tools before npm ci/u);
	}
});

void test('native ARM guard checks setup order before verified dependency reuse', () => {
	const steps = nativeArmSteps('${{ matrix.arch }}');
	steps[2] = { uses: './.github/actions/verified-node-dependencies' };
	assertNativeArmSetup({ steps }, { arch: 'arm64' }, 'matrix', 'verified dependency reuse');
	assert.throws(() => assertNativeArmSetup(
		{ steps: [steps[0], steps[2], steps[1]] }, { arch: 'arm64' }, 'matrix', 'late tools',
	), /native Node\/tools before npm ci/u);
});

void test('native ARM guard rejects wrong, missing and foreign architecture bindings', () => {
	for (const architecture of ['x64', '${{ matrix.node_arch }}', '${{ matrix.target.arch }}']) {
		assert.throws(() => assertNativeArmSetup(
			{ steps: nativeArmSteps(architecture) }, { arch: 'arm64' }, 'matrix', architecture,
		), /Node architecture/u);
	}
	assert.throws(() => assertNativeArmSetup(
		{ steps: nativeArmSteps('${{ matrix.arch }}') },
		{ arch: 'x64', node_arch: 'arm64' }, 'matrix', 'unused native metadata',
	), /Node architecture/u);
	assert.throws(() => assertNativeArmSetup(
		{ steps: nativeArmSteps('${{ matrix.arch }}') },
		{ arch: 'arm64', tooling_node_arch: 'x64' }, 'matrix', 'foreign npm',
	), /npm architecture/u);
});

void test('native ARM guard refuses missing or late Node and native-tooling setup', () => {
	const steps = nativeArmSteps('${{ matrix.arch }}');
	for (const reordered of [
		steps.slice(1), [steps[0], steps[2]], [steps[2], steps[0], steps[1]],
		[steps[1], steps[0], steps[2]], [steps[0], steps[2], steps[1]],
	]) {
		assert.throws(() => assertNativeArmSetup(
			{ steps: reordered }, { arch: 'arm64' }, 'matrix', 'invalid order',
		), /native Node\/tools before npm ci/u);
	}
});
