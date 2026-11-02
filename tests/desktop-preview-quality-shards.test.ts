/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

interface Step {
	name?: string;
	run?: string;
	uses?: string;
	env?: Record<string, string>;
	with?: Record<string, unknown>;
}

interface Job {
	needs?: string | string[];
	if?: string;
	outputs?: Record<string, string>;
	steps?: Step[];
	'timeout-minutes'?: number;
}

interface Workflow { jobs: Record<string, Job> }

const { load } = createRequire(import.meta.url)('js-yaml') as { load: (source: string) => Workflow };
const STATIC_JOBS = ['lint', 'typecheck', 'audits', 'build'];
const RELEASE_OUTPUTS = ['release-products', 'release-product-pattern', 'release-assembler-arguments',
	'package-audit-arguments', 'release-channel'];

async function readWorkflow(): Promise<Workflow> {
	return load(await readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8'));
}

function job(workflow: Workflow, id: string): Job {
	const value = workflow.jobs[id];
	assert.ok(value, `missing ${id} job`);
	return value;
}

test('nightly static shards run independently with verified dependencies and the existing time bound', async () => {
	const workflow = await readWorkflow();
	for (const id of STATIC_JOBS) {
		const shard = job(workflow, id);
		assert.equal(shard.needs, undefined, `${id} must start independently`);
		assert.ok(shard['timeout-minutes'] && shard['timeout-minutes'] <= 45);
		assert.equal(shard.steps?.filter(step => step.uses === './.github/actions/verified-node-dependencies').length, 1);
		assert.ok(shard.steps?.some(step => step.with?.['node-version-file'] === '.nvmrc'));
		assert.ok(shard.steps?.some(step => step.run === 'npm install --global npm@12.0.1'));
	}
});

test('nightly quality aggregates every static shard and preserves release scope for existing consumers', async () => {
	const workflow = await readWorkflow();
	const quality = job(workflow, 'quality');
	assert.deepEqual(quality.needs, STATIC_JOBS);
	assert.equal(quality.if, 'always()');
	assert.deepEqual(Object.keys(quality.outputs ?? {}).sort(), [...RELEASE_OUTPUTS].sort());
	for (const output of RELEASE_OUTPUTS) {
		assert.equal(quality.outputs?.[output], `\${{ needs.build.outputs.${output} }}`);
		assert.ok(job(workflow, 'build').outputs?.[output]);
	}
	assert.equal(job(workflow, 'tests').needs, 'quality');
	for (const id of ['package', 'publish-assistance-runtime-handoff', 'soundscaper-project-library-lease-matrix']) {
		const needs = job(workflow, id).needs;
		assert.ok(Array.isArray(needs) && needs.includes('quality') && needs.includes('tests'));
	}
});

test('nightly quality refuses failure, cancellation, skipped shards and missing results', async () => {
	const quality = job(await readWorkflow(), 'quality');
	const guard = quality.steps?.find(step => step.env?.STATIC_JOB_RESULTS);
	assert.ok(guard?.run, 'quality must explicitly require successful static shards');
	assert.equal(guard.env?.STATIC_JOB_RESULTS, "${{ join(needs.*.result, ',') }}");
	const execute = (results: string): number | null => {
		const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', guard.run!], {
			env: { ...process.env, STATIC_JOB_RESULTS: results }, encoding: 'utf8',
		});
		assert.ifError(result.error);
		assert.equal(result.signal, null);
		return result.status;
	};
	assert.equal(execute(STATIC_JOBS.map(() => 'success').join(',')), 0);
	for (const outcome of ['failure', 'cancelled', 'skipped']) {
		for (const index of STATIC_JOBS.keys()) {
			assert.notEqual(execute(STATIC_JOBS.map((_, position) => position === index ? outcome : 'success').join(',')), 0,
				`${outcome} in shard ${index} must block the quality gate`);
		}
	}
	for (const missing of ['', 'success', 'success,success,success']) assert.notEqual(execute(missing), 0);
});

test('nightly keeps build-dependent transfer checks and one desktop runtime producer in the build shard', async () => {
	const workflow = await readWorkflow();
	const build = job(workflow, 'build');
	const steps = build.steps ?? [];
	const buildIndex = steps.findIndex(step => step.run === 'npm run build');
	const transferIndex = steps.findIndex(step => step.run?.includes('--test tests/project-transfer-standalone-page-chunks.test.ts'));
	assert.ok(buildIndex >= 0 && transferIndex > buildIndex);
	assert.equal(steps[transferIndex]?.env?.SOUNDSCAPER_TRANSFER_BUILD_REQUIRED, '1');
	const producer = './.github/actions/prepare-desktop-runtime-test-fixture';
	assert.equal(steps.filter(step => step.uses === producer).length, 1);
	assert.equal(Object.values(workflow.jobs).flatMap(value => value.steps ?? []).filter(step => step.uses === producer).length, 1);
	for (const id of ['build', 'audits']) {
		assert.ok(job(workflow, id).steps?.some(step => step.with?.['fetch-depth'] === 0), `${id} requires Git history`);
	}
});
