/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

function deployPredicate(job) {
	const expression = /^ {4}if: (.+)$/mu.exec(job)?.[1];
	assert.ok(expression);
	if (expression !== '>-') return expression;
	const block = /^ {4}if: >-\n((?: {6}.+\n)+)/mu.exec(job)?.[1];
	assert.ok(block);
	return block.trim().replace(/\n\s+/gu, ' ');
}

test('handbook builders retain complete content history in both checked and deployed builds', async () => {
	const workflow = await readWorkflow('quality.yml');
	for (const name of ['build', 'deploy']) {
		const checkout = extractJob(workflow, name).split(/\n {6}- /u).find(step => step.includes('uses: actions/checkout@'));
		assert.ok(checkout);
		assert.match(checkout, /fetch-depth: 0/u, `${name} must preserve each handbook page's actual change date`);
		assert.match(checkout, /persist-credentials: false/u);
	}
});

test('translation deployment requires an explicit matching-SHA main dispatch after every existing gate', async () => {
	const workflow = await readWorkflow('quality.yml');
	const deploy = extractJob(workflow, 'deploy');
	assert.match(deploy, /needs: \[coverage, browser, firefox, native-platform-compile\]/u);
	const predicate = deployPredicate(deploy);
	const sha = 'a'.repeat(40);
	for (const [event, ref, inputs, expected] of [
		['push', 'refs/heads/main', {}, true],
		['push', 'refs/heads/topic', {}, false],
		['pull_request', 'refs/heads/main', { deploy_translations: true, translation_sync_sha: sha }, false],
		['workflow_dispatch', 'refs/heads/main', {}, false],
		['workflow_dispatch', 'refs/heads/main', { deploy_translations: false, translation_sync_sha: sha }, false],
		['workflow_dispatch', 'refs/heads/main', { deploy_translations: true, translation_sync_sha: 'b'.repeat(40) }, false],
		['workflow_dispatch', 'refs/heads/topic', { deploy_translations: true, translation_sync_sha: sha }, false],
		['workflow_dispatch', 'refs/heads/main', { deploy_translations: true, translation_sync_sha: sha }, true],
	]) {
		const result = runInNewContext(`(${predicate})`, { github: { event_name: event, ref, sha }, inputs });
		assert.equal(Boolean(result), expected, `${event} ${ref} ${JSON.stringify(inputs)}`);
	}
	assert.match(workflow, /deploy_translations:\n\s+description:[^\n]+\n\s+type: boolean\n\s+default: false/u);
});

test('the sync requests deployment of the exact commit it pushed without changing token recursion protection', async () => {
	const sync = await readWorkflow('sync-audacity-translations.yml');
	assert.match(sync, /permissions:\n\s+contents: write\n\s+actions: write/u);
	const dispatch = sync.slice(sync.indexOf('- name: Run the quality gate on the synced layer'));
	assert.match(dispatch, /if: steps\.commit\.outputs\.changed == 'true'/u);
	assert.match(dispatch, /GH_TOKEN: \$\{\{ github\.token \}\}/u);
	assert.match(dispatch, /gh workflow run quality\.yml --ref main/u);
	assert.match(dispatch, /-f deploy_translations=true/u);
	assert.match(dispatch, /-f translation_sync_sha="\$\(git rev-parse HEAD\)"/u);
});
