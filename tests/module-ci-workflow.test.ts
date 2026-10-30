/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

interface Step { name: string; run?: string; uses?: string; with?: Record<string, string>; env?: Record<string, string> }
interface Job { needs?: string[] | string; if?: string; env?: Record<string, string>; steps: Step[] }
const require = createRequire(import.meta.url);
const { load } = require('js-yaml') as { load: (input: string) => { jobs: Record<string, Job> } };
const { jobs } = load(readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8'));

test('Quality produces one module plan and supplies the same revision artifact to every test consumer', () => {
	const producer = jobs.build!;
	const planning = producer.steps.findIndex(step => step.name === 'Plan affected module checks');
	assert.ok(planning >= 0 && planning < producer.steps.findIndex(step => step.name === 'Build the site'));
	assert.match(producer.steps[planning]!.run!, /--ci.*--base=.*--list.*--output=\.wrangler\/module-plan\.json/u);
	const artifact = producer.steps.find(step => step.name === 'Upload the revision-bound module plan')!.with!.name;
	for (const id of ['tests', 'browser', 'firefox', 'coverage']) {
		const job = jobs[id]!;
		assert.equal(job.env!.SCAPE_MODULE_PLAN, '.wrangler/module-plan.json');
		assert.equal(job.steps.find(step => step.name === 'Download the revision-bound module plan')!.with!.name, artifact);
	}
});

test('Quality aggregate observes every prerequisite even when a dependency failed', () => {
	const aggregate = jobs.coverage!;
	assert.equal(aggregate.if, 'always()');
	for (const id of ['build', 'tests', 'native-platform-compile', 'browser', 'firefox', 'lint', 'typecheck', 'audits']) {
		assert.ok(Array.isArray(aggregate.needs) && aggregate.needs.includes(id));
	}
	const validation = aggregate.steps.findIndex(step => step.name === 'Require every planned prerequisite to succeed');
	assert.ok(validation >= 0 && validation < aggregate.steps.findIndex(step => step.name === "Download every shard's coverage"));
	assert.equal(aggregate.steps[validation]!.env!.SCAPE_QUALITY_RESULTS, '${{ toJSON(needs) }}');
});
