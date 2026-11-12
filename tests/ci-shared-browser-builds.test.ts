/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('nightly targets consume the four revision-bound browser configurations from one verified producer', async () => {
	const workflow = await readWorkflow('desktop-nightly-tests.yml');
	const producer = extractJob(workflow, 'browser-sites');
	const consumer = extractJob(workflow, 'package-with-tests');
	assert.match(producer, /runs-on: ubuntu-24\.04/u);
	assert.doesNotMatch(producer, /matrix:/u);
	for (const command of ['npm run build', 'npm run build:browser:framescaper',
		'npm run prepare:browser:products', 'npm run pretest:browser:dual-origin',
		'node scripts/verify-nightly-browser-sites.mjs']) assert.ok(producer.includes(command), command);
	assert.match(producer, /name: nightly-browser-sites-\$\{\{ github\.sha \}\}/u);
	assert.match(producer, /include-hidden-files: true/u);
	assert.match(producer, /\.wrangler\/browser-products\/[\s\S]*?\.wrangler\/dual-origin-browser\//u);
	assert.match(consumer, /needs: \[nightly-test-targets, browser-sites\]/u);
	assert.match(consumer, /name: nightly-browser-sites-\$\{\{ github\.sha \}\}/u);
	assert.doesNotMatch(consumer, /npm run (?:build|build:browser:framescaper|prepare:browser:products|pretest:browser:dual-origin)\s*\n/u);
	assert.ok(consumer.indexOf('Download the verified browser product sites')
		< consumer.indexOf('node scripts/verify-nightly-browser-sites.mjs'));
	assert.ok(consumer.indexOf('node scripts/verify-nightly-browser-sites.mjs')
		< consumer.indexOf('node scripts/desktop-nightly-tests-products.mjs'));
	assert.match(consumer, /node scripts\/ci-build-os-audio-codec-host\.mjs/u);
	assert.match(consumer, /node scripts\/desktop-nightly-tests-prepare\.mjs/u);
});
