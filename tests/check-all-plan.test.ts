/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createCheckAllPlan } from '../scripts/lib/check-all-plan.ts';

const root = new URL('../', import.meta.url).pathname.replace(/\/$/u, '');
const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };

test('check-all includes every static gate, all Node shards, fresh coverage and all browser projects', () => {
	const plan = createCheckAllPlan(root, '/npm-cli.js', scripts);
	for (const script of ['check:architecture', 'audit:ci', 'docs:check', 'typecheck:sources', 'typecheck:tests']) {
		assert.ok(plan.some(job => job.args.includes(script)), script);
	}
	assert.equal(plan.filter(job => job.id.startsWith('lint/')).length, 8);
	const node = plan.filter(job => job.id.startsWith('node/'));
	assert.deepEqual(node.map(job => job.id), ['node/common-1', 'node/common-2', 'node/framescaper', 'node/soundscaper', 'node/lightscaper']);
	assert.equal(new Set(node.map(job => job.args.find(arg => arg.startsWith('--coverage-directory=')))).size, 5);
	const coverage = plan.find(job => job.id === 'coverage');
	assert.equal(coverage?.dependsOn.length, 5);
	for (const dependency of coverage?.dependsOn ?? []) {
		const compact = plan.find(job => job.id === dependency);
		assert.equal(compact?.dependsOn.length, 1);
		assert.ok(compact?.dependsOn[0].startsWith('node/'));
	}
	const browser = plan.filter(job => job.browser);
	assert.equal(browser.length, 4);
	assert.deepEqual(browser.map(job => job.args.find(arg => arg.startsWith('--shard='))), ['--shard=1/4', '--shard=2/4', '--shard=3/4', '--shard=4/4']);
	assert.ok(browser.every(job => !job.args.some(arg => arg.startsWith('--project='))), 'the ordinary suite runs all three engines');
	assert.equal(new Set(browser.map(job => job.args.find(arg => arg.startsWith('--output=')))).size, 4);
	assert.ok(browser.every(job => job.dependsOn.includes('build')));
	assert.ok(plan.find(job => job.id === 'build')?.args.includes('pretest:browser'));
});

test('check-all refuses to silently omit a newly added unsupported static command', () => {
	assert.throws(() => createCheckAllPlan(root, '/npm-cli.js', { ...scripts, 'check:static': `${scripts['check:static']} && echo omitted` }), /check:static/u);
});

test('check-all browser shards retain native qualification with one worker and no retries', () => {
	const browser = createCheckAllPlan(root, '/npm-cli.js', scripts).filter(job => job.browser);
	assert.equal(browser.length, 4);
	for (const job of browser) {
		assert.deepEqual(job.args.filter(arg => arg.startsWith('--workers=')), ['--workers=1'], job.id);
		assert.deepEqual(job.args.filter(arg => arg.startsWith('--retries=')), ['--retries=0'], job.id);
	}
});
