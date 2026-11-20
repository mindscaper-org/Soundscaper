/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('desktop fixture producers and test jobs verify restored installed trees before their consumers', async () => {
	for (const [workflow, jobs] of [['quality.yml', ['build', 'tests']], ['desktop-preview.yml', ['tests']], ['soundscaper-stable-1.yml', ['tests', 'browser']]]) {
		for (const name of jobs) assert.match(extractJob(await readWorkflow(workflow), name), /uses: \.\/\.github\/actions\/verified-node-dependencies/u);
	}
	const action = await readFile(new URL('../.github/actions/verified-node-dependencies/action.yml', import.meta.url), 'utf8');
	assert.match(action, /verify dependencies >> "\$GITHUB_OUTPUT"/u);
	assert.match(action, /if: steps\.verification\.outputs\.valid != 'true'[\s\S]*?run: npm ci/u);
	assert.match(action, /actions\/cache\/restore@[a-f0-9]{40}/u);
	assert.match(action, /actions\/cache\/save@[a-f0-9]{40}/u);
	assert.match(action, /key: verified-node-modules-v1-\$\{\{ steps\.identity\.outputs\.key \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
	assert.match(action, /restore-keys: verified-node-modules-v1-\$\{\{ steps\.identity\.outputs\.key \}\}-\s*\n/u);
});

test('Firefox shards reuse verified engine bytes and run with live audio and a WebGL2 display', async () => {
	for (const workflow of ['quality.yml']) {
		const job = extractJob(await readWorkflow(workflow), 'firefox');
		assert.match(job, /uses: \.\/\.github\/actions\/verified-firefox/u);
		assert.match(job, /ci-firefox-pulseaudio\.sh/u);
		assert.match(job, /ci-apt-install\.sh[^\n]*xvfb[^\n]*libgl1-mesa-dri/u);
		assert.match(job, /LIBGL_ALWAYS_SOFTWARE: '1'/u);
		assert.match(job, /GALLIUM_DRIVER: llvmpipe/u);
		assert.match(job, /run: xvfb-run --auto-servernum node scripts\/ci-firefox-audio-clock\.mjs/u);
		// The complete partition is enforced by playwright-config.test.js.
		assert.match(job, /run: xvfb-run --auto-servernum npm run test:browser:built -- --project=firefox --suite-shard=\$\{\{ matrix\.shard \}\}\/\d+ --workers=2/u);
	}
	const action = await readFile(new URL('../.github/actions/verified-firefox/action.yml', import.meta.url), 'utf8');
	assert.match(action, /run: npx playwright install-deps firefox/u);
	assert.match(action, /verify firefox >> "\$GITHUB_OUTPUT"/u);
	assert.match(action, /run: node scripts\/ci-input-cache\.mjs reset firefox/u);
	assert.match(action, /if: steps\.verification\.outputs\.valid != 'true'[\s\S]*?run: npx playwright install firefox/u);
	assert.match(action, /actions\/cache\/save@[a-f0-9]{40}/u);
});
