/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { expandNpmScript, readWorkflow } from './helpers/workflow-jobs.js';

test('handbook publication runs weekly or manually without any product gate', async () => {
	const workflow = await readWorkflow('handbook.yml');
	const header = workflow.slice(0, workflow.indexOf('\njobs:\n'));
	assert.match(header, /schedule:\s+(?:#.*\n\s+)*- cron: '43 4 \* \* 1'/u);
	assert.match(header, /workflow_dispatch:/u);
	assert.doesNotMatch(header, /push:|pull_request:|workflow_run:/u);
	assert.match(workflow, /product: \[soundscaper, framescaper\]/u);
	assert.match(workflow, /SCAPE_PRODUCT: \$\{\{ matrix\.product \}\}/u);
	assert.match(workflow, /npm run docs:check/u);
	assert.match(workflow, /npx playwright test --config playwright\.docs\.config\.mjs/u);
	assert.match(workflow, /node scripts\/prepare-handbook-deploy\.mjs/u);
	assert.match(workflow, /npx wrangler deploy --config wrangler\.handbook\.jsonc --env \$\{\{ matrix\.product \}\}/u);
	assert.doesNotMatch(workflow, /needs:|npm run (?:check(?::static)?|build(?::pages)?|test:browser)\s*\n/u);
	assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
});

test('product CI never generates or browser-tests the handbook', async () => {
	for (const name of ['quality.yml', 'desktop-preview.yml', 'soundscaper-stable-1.yml']) {
		const workflow = await readWorkflow(name);
		assert.doesNotMatch(workflow, /npm run docs:|playwright\.docs\.config|ci-handbook-build|stage-handbook-build/u, name);
	}
	const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
	for (const command of ['check:static', 'build:pages']) {
		assert.ok(expandNpmScript(scripts, command).every((script: string) => !script.startsWith('docs:')), command);
	}
	assert.doesNotMatch(scripts['build:pages'], /stage-handbook-build/u);
	assert.match(await readFile(new URL('../scripts/preflight-pages-deploy.mjs', import.meta.url), 'utf8'), /await verifyIndependentHandbook/u);
});

test('handbook-only pushes do not start product quality or desktop artifact builds', async () => {
	for (const name of ['quality.yml', 'desktop-nightly-tests.yml']) {
		const workflow = await readWorkflow(name);
		const header = workflow.slice(0, workflow.indexOf('\njobs:\n'));
		assert.match(header, /paths-ignore:\n\s+- 'handbook\/\*\*'\n\s+- 'docs\/\*\*'/u, name);
	}
});
