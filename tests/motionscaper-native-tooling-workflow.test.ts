/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { load } = require('js-yaml') as { load: (source: string) => unknown };

function record(value: unknown): Record<string, unknown> {
	assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

function workflowJob(file: string, id: string): Record<string, unknown> {
	const source = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
	return record(record(record(load(source)).jobs)[id]);
}

const targets = ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'];

for (const [file, id, matrixName] of [
	['motionscaper-desktop-preview.yml', 'package', 'target'],
	['motionscaper-media-host-native-build.yml', 'build', 'include'],
] as const) {
	test(`Motion ${id} binds native Node and verified tooling before npm on every target`, () => {
		const job = workflowJob(file, id);
		const matrix = record(record(job.strategy).matrix);
		assert.ok(Array.isArray(matrix[matrixName]));
		const rows = matrix[matrixName].map(record);
		assert.deepEqual(rows.map(row => row.id ?? row.target), targets);
		for (const row of rows) {
			const target = String(row.id ?? row.target);
			assert.equal(row.node_arch, target.endsWith('-arm64') ? 'arm64' : 'x64', target);
		}
		assert.ok(Array.isArray(job.steps));
		const steps = job.steps.map(record);
		const node = steps.findIndex(step => String(step.uses).startsWith('actions/setup-node@'));
		assert.ok(node >= 0);
		assert.equal(record(steps[node]!.with).architecture, id === 'package' ? '${{ matrix.target.node_arch }}' : '${{ matrix.node_arch }}');
		const native = steps.findIndex(step => step.uses === './.github/actions/setup-native-tooling');
		const npm = steps.findIndex(step => step.run === 'npm install --global npm@12.0.1');
		const install = steps.findIndex(step => step.run === 'npm ci');
		assert.ok(native > node && npm > native && install > npm, `${file}: native tool selection must precede both npm operations`);
	});
}

test('Motion Windows media builds keep native Ninja and select the target-native compiler host', () => {
	const job = workflowJob('motionscaper-media-host-native-build.yml', 'build');
	const matrix = record(record(job.strategy).matrix);
	assert.ok(Array.isArray(matrix.include));
	for (const row of matrix.include.map(record)) {
		if (row.target === 'win-x64') assert.equal(row.vs_arch, 'amd64');
		if (row.target === 'win-arm64') assert.equal(row.vs_arch, 'arm64');
	}
	assert.ok(Array.isArray(job.steps));
	const steps = job.steps.map(record);
	const native = steps.find(step => step.uses === './.github/actions/setup-native-tooling');
	assert.ok(native);
	assert.equal(record(native.with)['windows-media-tools'], 'true');
	const windows = steps.find(step => step.name === 'Install Windows media build tools');
	assert.ok(windows);
	assert.equal(windows.if, "runner.os == 'Windows' && runner.arch != 'ARM64'");
	assert.doesNotMatch(String(windows.run), /\bninja\b/u);
	const compiler = steps.find(step => step.name === 'Activate the target-native MSVC environment');
	assert.ok(compiler);
	assert.equal(record(compiler.env).FRAMESCAPER_VS_ARCH, '${{ matrix.vs_arch }}');
	assert.match(String(compiler.run), /-arch=\$env:FRAMESCAPER_VS_ARCH -host_arch=\$env:FRAMESCAPER_VS_ARCH/u);
});
