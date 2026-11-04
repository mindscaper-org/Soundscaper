/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

const { load } = createRequire(import.meta.url)('js-yaml');

test('each workflow compiles the desktop test runtime once and shares authenticated private-copy input across consuming execution slots', async () => {
	for (const [workflow, producer] of [['quality.yml', 'build'], ['desktop-preview.yml', 'build'], ['soundscaper-stable-1.yml', 'source']]) {
		const source = await readWorkflow(workflow);
		assert.match(extractJob(source, producer), /uses: \.\/\.github\/actions\/prepare-desktop-runtime-test-fixture/u);
		const consumers = extractJob(source, 'tests');
		assert.match(consumers, /name: node-desktop-runtime-fixture-\$\{\{ github\.sha \}\}/u);
		assert.match(consumers, /if: steps\.test-prerequisites\.outputs\.desktop_runtime == 'true'/u);
		assert.match(consumers, /--desktop-runtime-fixture=\.wrangler\/node-desktop-runtime-fixture/u);
	}
	const action = await readFile(new URL('../.github/actions/prepare-desktop-runtime-test-fixture/action.yml', import.meta.url), 'utf8');
	assert.match(action, /node scripts\/prepare-node-desktop-runtime-artifact\.mjs/u);
	assert.match(action, /node scripts\/compact-v8-coverage\.mjs coverage\/v8-desktop-fixture coverage\/shards\/desktop-runtime-fixture\.json/u);
	assert.match(action, /name: \$\{\{ inputs\.coverage-prefix \}\}desktop-runtime-fixture/u);
	assert.match(action, /include-hidden-files: true/u);
});

test('only workflows with a coverage union collect and upload desktop fixture coverage', async () => {
	const action = load(await readFile(new URL('../.github/actions/prepare-desktop-runtime-test-fixture/action.yml', import.meta.url), 'utf8'));
	assert.equal(action.inputs['collect-coverage'].default, 'true');
	for (const [workflow, producer, expected] of [
		['quality.yml', 'build', 'true'],
		['desktop-preview.yml', 'build', 'false'],
		['soundscaper-stable-1.yml', 'source', 'true'],
	]) {
		const source = load(await readWorkflow(workflow));
		const prepare = source.jobs[producer].steps.find(step => step.uses === './.github/actions/prepare-desktop-runtime-test-fixture');
		assert.equal(prepare.with?.['collect-coverage'] ?? action.inputs['collect-coverage'].default, expected, workflow);
	}
	const compile = action.runs.steps.find(step => step.run === 'node scripts/prepare-node-desktop-runtime-artifact.mjs');
	assert.equal(compile.env.NODE_V8_COVERAGE,
		"${{ inputs.collect-coverage == 'true' && format('{0}/coverage/v8-desktop-fixture', github.workspace) || '' }}");
	const coverage = action.runs.steps.filter(step => step.run?.includes('compact-v8-coverage.mjs')
		|| step.with?.name === '${{ inputs.coverage-prefix }}desktop-runtime-fixture');
	assert.equal(coverage.length, 2);
	for (const step of coverage) assert.equal(step.if, "inputs.collect-coverage == 'true'");
	const fixture = action.runs.steps.find(step => step.with?.name === 'node-desktop-runtime-fixture-${{ github.sha }}');
	assert.ok(fixture, 'the shared runtime remains available without coverage');
	assert.equal(fixture.if, undefined);
});
