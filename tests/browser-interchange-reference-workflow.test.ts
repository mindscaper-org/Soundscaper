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
		for (const [product, artifact] of [
			['soundscaper', 'verified-soundscaper-browser-site-build'],
			['framescaper', 'verified-framescaper-site-build'],
			['lightscaper', 'verified-lightscaper-site-build'],
		] as const) {
			const download = job.split(/\n {6}- /u).find((step: string) => step.includes(`name: ${artifact}\n`));
			assert.ok(download?.includes('uses: actions/download-artifact@'));
			assert.ok(download.includes(`path: .wrangler/browser-products/${product}\n`));
			assert.doesNotMatch(download, /^ +if:/mu, 'every selected spec may import a production artifact during collection');
			assert.ok(job.indexOf(download) < selection, `${product} assets must exist before Playwright imports the selected specs`);
		}
		assert.ok(job.includes(jobName === 'browser' ? '--project=${{ matrix.project }}' : '--project=firefox'));
		assert.ok(job.includes(jobName === 'browser' ? '--shard=${{ matrix.shard }}/3' : '--shard=${{ matrix.shard }}/4'));
		for (const step of job.split(/\n {6}- /u).filter((step: string) => (
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
		const provisions = job.split(/\n {6}- /u).filter((step: string) => step.includes('run: npm run provision:interchange-conformance'));
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
