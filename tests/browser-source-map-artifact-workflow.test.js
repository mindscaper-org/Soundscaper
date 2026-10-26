/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

const SOURCE_MAP_ARTIFACTS = Object.freeze([
	['verified-site-source-maps', '.wrangler/browser-products/soundscaper-source-maps'],
	['verified-framescaper-site-source-maps', '.wrangler/browser-products/framescaper-source-maps'],
]);

test('only Chromium coverage jobs download the authenticated product source maps', async () => {
	const workflow = await readWorkflow('quality.yml');
	const downloads = extractJob(workflow, 'browser').split(/\n {6}- /u)
		.filter(step => /uses: actions\/download-artifact@/u.test(step));
	for (const [name, path] of SOURCE_MAP_ARTIFACTS) {
		const matching = downloads.filter(step => step.includes(`name: ${name}\n`));
		assert.equal(matching.length, 1, `Chromium must download ${name} exactly once`);
		assert.ok(matching[0].includes(`path: ${path}\n`), `${name} must land at its consumed path`);
		assert.match(matching[0], /if: matrix\.project == 'chromium'/u);
		assert.ok(!extractJob(workflow, 'firefox').includes(`name: ${name}\n`));
	}
});

test('the producer publishes prepared Soundscaper bytes and consumers authenticate them unchanged', async () => {
	const workflow = await readWorkflow('quality.yml');
	const producer = extractJob(workflow, 'build');
	assert.ok(producer.indexOf('run: npm run prepare:browser:products') > producer.indexOf('run: npm run build:browser:framescaper'));
	assert.match(producer, /name: verified-soundscaper-browser-site-build\n\s+path: \.wrangler\/browser-products\/soundscaper\/\n\s+include-hidden-files: true/u);
	for (const name of ['browser', 'firefox']) {
		const job = extractJob(workflow, name);
		assert.match(job, /SCAPE_BROWSER_PRODUCTS_PREPARED: '1'/u);
		assert.match(job, /name: verified-soundscaper-browser-site-build\n\s+path: \.wrangler\/browser-products\/soundscaper/u);
		assert.doesNotMatch(job, /name: verified-site-build\n\s+path: dist/u);
	}
});
