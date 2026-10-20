/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

const SOURCE_MAP_ARTIFACTS = Object.freeze([
	['verified-site-source-maps', '.wrangler/browser-products/soundscaper-source-maps'],
	['verified-framescaper-site-source-maps', '.wrangler/browser-products/framescaper-source-maps'],
]);

test('every browser engine receives the source maps required to verify both product sites', async () => {
	const workflow = await readWorkflow('quality.yml');
	for (const jobName of ['browser', 'firefox']) {
		const downloads = extractJob(workflow, jobName).split(/\n {6}- /u)
			.filter((step) => /uses: actions\/download-artifact@/u.test(step));
		for (const [name, path] of SOURCE_MAP_ARTIFACTS) {
			const matching = downloads.filter((step) => step.includes(`name: ${name}\n`));
			assert.equal(matching.length, 1, `${jobName} must download ${name} exactly once`);
			assert.ok(matching[0].includes(`path: ${path}\n`), `${jobName} must place ${name} at its consumed path`);
		}
	}
});
