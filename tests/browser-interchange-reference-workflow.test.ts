/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

const REQUIRED = "if: steps.test-prerequisites.outputs.interchange == 'true'";

for (const jobName of ['browser', 'firefox']) {
	test(`Quality ${jobName} provisions readers for the exact Playwright selection`, async () => {
		const job = extractJob(await readWorkflow('quality.yml'), jobName);
		const selection = job.indexOf('node scripts/ci-test-prerequisites.mjs');
		const provision = job.indexOf('run: npm run provision:interchange-conformance');
		assert.ok(selection >= 0 && provision > selection);
		assert.ok(job.includes(jobName === 'browser' ? '--project=${{ matrix.project }}' : '--project=firefox'));
		assert.ok(job.includes('--shard=${{ matrix.shard }}/12'));
		for (const step of job.split(/\n {6}- /u).filter(step => (
			step.includes('uses: actions/setup-python@') || step.includes('id: interchange-cache-key')
			|| step.includes('path: .wrangler/test-download-cache/interchange')
			|| step.includes('run: npm run provision:interchange-conformance')
		))) assert.ok(step.includes(REQUIRED), 'only selected reader consumers need Python, downloads, and extraction');
		assert.match(job, /uses: actions\/setup-python@[a-f0-9]{40}/u);
		assert.match(job, /python-version: '3\.12'/u);
		assert.ok(job.search(/run: npm run test:browser:built/u) > provision);
	});
}

for (const workflowName of ['quality.yml', 'desktop-preview.yml', 'soundscaper-stable-1.yml']) {
	test(`${workflowName} Node prerequisites follow the actual selected shard closure`, async () => {
		const job = extractJob(await readWorkflow(workflowName), 'tests');
		assert.ok(job.includes('node scripts/ci-test-prerequisites.mjs --node-shard=${{ matrix.shard }}'));
		const provisions = job.split(/\n {6}- /u).filter(step => step.includes('run: npm run provision:interchange-conformance'));
		assert.equal(provisions.length, 1);
		assert.ok(provisions[0]?.includes(REQUIRED));
	});
}

test('the unsharded stable browser gate still requires its independent readers', async () => {
	const job = extractJob(await readWorkflow('soundscaper-stable-1.yml'), 'browser');
	assert.match(job, /uses: actions\/setup-python@[a-f0-9]{40}/u);
	const provision = job.indexOf('run: npm run provision:interchange-conformance');
	assert.ok(provision >= 0 && job.indexOf('run: npm run test:browser:built') > provision);
});
