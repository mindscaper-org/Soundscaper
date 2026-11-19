/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

interface WorkflowJob {
	needs?: string | string[];
	strategy?: { matrix: Record<string, unknown[]>; 'max-parallel'?: number };
	'timeout-minutes': number;
	steps: { name?: string; 'timeout-minutes'?: number }[];
}

const require = createRequire(import.meta.url);
const { load } = require('js-yaml') as { load: (source: string) => { jobs: Record<string, WorkflowJob> } };
const { jobs } = load(await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8'));

function jobCount(job: WorkflowJob): number {
	const matrix = job.strategy?.matrix ?? {};
	assert.ok(!('include' in matrix) && !('exclude' in matrix), 'account for matrix overrides before changing the runner budget');
	return Object.values(matrix).reduce((total, axis) => total * axis.length, 1);
}

test('Quality schedules at most 25 jobs including coverage and deployment', () => {
	const total = Object.values(jobs).reduce((sum, job) => sum + jobCount(job), 0);
	assert.ok(total <= 25, `Quality schedules ${total} jobs; consolidate work before adding more runners`);
});

test('Quality leaves one of the organization’s 20 runner slots available', () => {
	const entries = Object.entries(jobs);
	const dependencies = new Map(entries.map(([id, job]) => [id, ancestors(job)]));
	let peak = 0;

	// Jobs related through needs cannot overlap. Find the heaviest set of
	// unrelated jobs, counting each matrix leg as a separate runner.
	function visit(index: number, active: string[], runners: number): void {
		if (index === entries.length) {
			peak = Math.max(peak, runners);
			return;
		}
		visit(index + 1, active, runners);
		const [id, job] = entries[index];
		if (active.some(other => dependencies.get(id)?.has(other) || dependencies.get(other)?.has(id))) return;
		const count = Math.min(jobCount(job), job.strategy?.['max-parallel'] ?? Infinity);
		visit(index + 1, [...active, id], runners + count);
	}

	visit(0, [], 0);
	assert.ok(peak <= 19, `Quality can occupy ${peak} runners at once, exceeding its 19-slot budget`);
});

test('consolidated browser jobs retain the previous aggregate test budget and Firefox setup time', () => {
	const browser = jobs.browser;
	const firefox = jobs.firefox;
	const browserTests = browser.steps.find(step => step.name === 'Run browser workflows against the existing build');
	const firefoxTests = firefox.steps.find(step => step.name === 'Run Firefox workflows against the existing build');
	assert.ok(browserTests);
	assert.ok(firefoxTests?.['timeout-minutes']);
	for (const [job, step] of [[browser, browserTests], [firefox, firefoxTests]] as const) {
		const minutes = Math.min(job['timeout-minutes'], step['timeout-minutes'] ?? job['timeout-minutes']);
		const shards = job.strategy?.matrix.shard.length ?? 1;
		assert.ok(shards * minutes >= 12 * 60, `${shards} browser shards need more than ${minutes} effective minutes each`);
	}
	assert.ok(firefox['timeout-minutes'] >= firefoxTests['timeout-minutes'] + 30,
		'Firefox installation time must remain separate from its test deadline');
});

function ancestors(job: WorkflowJob): Set<string> {
	const needs = job.needs === undefined ? [] : typeof job.needs === 'string' ? [job.needs] : job.needs;
	return new Set(needs.flatMap(id => [id, ...ancestors(jobs[id])]));
}
