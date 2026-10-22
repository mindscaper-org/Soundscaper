/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { extractJob } from './helpers/workflow-jobs.js';

test('ordinary browser CI authenticates and transfers Lightscaper builds and sibling maps', async () => {
	for (const [workflowName, buildJob] of [['quality.yml', 'build']]) {
		const source = await workflow(workflowName);
		const publisher = extractJob(source, buildJob);
		const buildIndex = publisher.indexOf('npm run build:browser:lightscaper');
		assert.ok(buildIndex >= 0, `${workflowName} must build Lightscaper`);
		assert.ok(publisher.indexOf('name: verified-lightscaper-site-build') > buildIndex);
		assert.match(publisher,
			/name: verified-lightscaper-site-build\n\s+path: \.wrangler\/browser-products\/lightscaper\/\n\s+include-hidden-files: true/u);
		assert.match(publisher,
			/name: verified-lightscaper-site-source-maps\n\s+path: \.wrangler\/browser-products\/lightscaper-source-maps\//u);
		for (const jobName of ['browser', 'firefox']) {
			const job = extractJob(source, jobName);
			assert.match(job,
				/name: verified-lightscaper-site-build\n\s+path: \.wrangler\/browser-products\/lightscaper/u);
			assert.match(job,
				/name: verified-lightscaper-site-source-maps\n\s+path: \.wrangler\/browser-products\/lightscaper-source-maps/u);
			assert.ok(job.indexOf('name: verified-lightscaper-site-source-maps') < job.indexOf('npm run test:browser:built'));
		}
	}
});

test('desktop preview delegates ordinary browser artifacts to Quality', async () => {
	const source = await workflow('desktop-preview.yml');
	assert.match(extractJob(source, 'quality'), /# testing and combined coverage enforcement belong to quality\.yml\./u);
	assert.doesNotMatch(source, /name: verified-lightscaper-site-(?:build|source-maps)/u,
		'desktop distribution does not publish the ordinary browser site artifacts');
});

test('other ordinary browser build callers include Lightscaper before site preparation', async () => {
	for (const workflowName of ['desktop-nightly-tests.yml', 'diagnostic-metrics.yml']) {
		const source = await workflow(workflowName);
		assert.ok(source.includes('npm run build:browser:lightscaper'), `${workflowName} must stage the photo browser product`);
		if (source.includes('npm run prepare:browser:products')) {
			assert.ok(source.indexOf('npm run build:browser:lightscaper') < source.indexOf('npm run prepare:browser:products'));
		}
	}
	const stable = await workflow('soundscaper-stable-1.yml');
	assert.match(stable, /npm run build:browser:lightscaper/u);
	assert.equal([...stable.matchAll(/name: soundscaper-stable-1-lightscaper-browser-site/gu)].length, 2);
	assert.match(stable, /name: soundscaper-stable-1-lightscaper-browser-site\n\s+path: \.wrangler\/browser-products\/lightscaper\/\n\s+include-hidden-files: true/u);
});

test('ordinary browser CI executes the exact collected shard with its required run policy', async () => {
	const source = await workflow('quality.yml');
	assert.match(extractJob(source, 'browser'), /timeout-minutes: \$\{\{ matrix\.project == 'chromium' && 120 \|\| 60 \}\}/u,
		'serial Chromium photo workflows need a bounded job window beyond their observed 88-minute phase');
	for (const [jobName, collectName, runName, project, shard, normalWorkers] of [
		['browser', 'Collect browser shard run shape', 'Run browser workflows against the existing build', '${{ matrix.project }}', "${{ matrix.shard }}/${{ matrix.project == 'webkit' && 8 || 4 }}", "${{ matrix.project == 'webkit' && 1 || 2 }}"],
		['firefox', 'Collect Firefox shard run shape', 'Run Firefox workflows against the existing build', 'firefox', '${{ matrix.shard }}/6', '1'],
	]) {
		const job = extractJob(source, jobName), collect = step(job, collectName), run = step(job, runName);
		assert.ok(job.indexOf(collectName) < job.indexOf(runName), `${jobName} must collect before execution`);
		assert.ok(collect.includes('id: browser-run-shape'));
		assert.ok(collect.includes(`node node_modules/@playwright/test/cli.js test --config=playwright.config.mjs --project=${project} --shard=${shard} --workers=${normalWorkers} --retries=1 --list --reporter=json > "$RUNNER_TEMP/browser-shard-collection.json"`));
		const projectArgument = jobName === 'browser' ? `"${project}"` : project, workersArgument = jobName === 'browser' ? `"${normalWorkers}"` : normalWorkers;
		assert.ok(collect.includes(`node scripts/ci-browser-shard-policy.ts "$RUNNER_TEMP/browser-shard-collection.json" ${projectArgument} "${shard}" ${workersArgument} >> "$GITHUB_OUTPUT"`));
		assert.ok(run.includes(`npm run test:browser:built -- --project=${project} --shard=${shard} --workers=\${{ steps.browser-run-shape.outputs.workers }} --retries=\${{ steps.browser-run-shape.outputs.retries }}`));
		assert.doesNotMatch(collect + run, /--grep(?:[= ]|$)/u, 'policy selection must not filter the shard');
		assert.doesNotMatch(run.split('\n').find(line => line.trimStart().startsWith('run:')) ?? '', /--list/u, 'the execution step must run the collected tests');
		for (const name of ['SCAPE_BROWSER_COVERAGE', 'PWTEST_SHARD_WEIGHTS']) {
			const expression = block => block.split('\n').find(line => line.trimStart().startsWith(`${name}:`))?.trim();
			assert.equal(expression(collect), expression(run), `${jobName} must collect with the execution ${name}`);
			if (jobName === 'browser') assert.ok(expression(run), `${name} must remain explicit for the shared browser matrix`);
		}
	}
});

function step(job, name) {
	const block = job.split('\n      - name: ').find(value => value.startsWith(`${name}\n`));
	assert.ok(block, `Missing workflow step: ${name}`); return block;
}

async function workflow(name) {
	return readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
}
