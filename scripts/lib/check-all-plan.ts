/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { LINT_SHARD_IDS } from './lint-shards.mjs';
import { NODE_TEST_SHARD_IDS } from './node-test-shards.mjs';
import type { CheckTask } from './check-all-scheduler.ts';

export const CHECK_ALL_NODE_DIRECTORY = 'coverage/check-all/node';

/** Derive static membership from the canonical gate so future checks cannot disappear. */
export function createCheckAllPlan(root: string, npmCli: string, scripts: Record<string, string>): CheckTask[] {
	const npm = (id: string, script = id): CheckTask => ({ id, args: [npmCli, 'run', script], dependsOn: [] });
	// The complete selection includes OTIO/EDL/FCPXML readers and DAWproject
	// schema validation. Verify their pinned packages before test shards start.
	const interchangePreparation = 'prepare/interchange';
	const tasks: CheckTask[] = [npm(interchangePreparation, 'provision:interchange-conformance')];
	for (const script of npmSteps(scripts['check:static'], 'check:static')) {
		if (script === 'lint') {
			tasks.push(...LINT_SHARD_IDS.map((shard: string) => ({
				id: `lint/${shard}`, args: [resolve(root, 'scripts/run-lint.mjs'), `--shard=${shard}`], dependsOn: [],
			})));
		} else if (script === 'typecheck') tasks.push(...npmSteps(scripts.typecheck, 'typecheck').map(id => npm(id)));
		else tasks.push({
			...npm(script, script === 'build' ? 'pretest:browser' : script),
			...(script === 'build' ? { env: { SCAPE_BROWSER_PRODUCTS_PREPARED: '', SCAPE_BROWSER_COVERAGE: '' } } : {}),
		});
	}
	if (!tasks.some(task => task.id === 'build')) throw new Error('check:static must include the browser prerequisite build.');
	for (const shard of NODE_TEST_SHARD_IDS) {
		tasks.push({
			id: `node/${shard}`, dependsOn: [interchangePreparation],
			args: [resolve(root, 'scripts/run-node-tests.mjs'), `--module-shard=${shard}`, `--coverage-directory=${CHECK_ALL_NODE_DIRECTORY}/raw/${shard}`],
			env: { SCAPE_CHECK_ALL_PROGRESS: '1' },
		}, {
			id: `compact/${shard}`, dependsOn: [`node/${shard}`],
			args: [resolve(root, 'scripts/compact-v8-coverage.mjs'), `${CHECK_ALL_NODE_DIRECTORY}/raw/${shard}`, `${CHECK_ALL_NODE_DIRECTORY}/shards/${shard}.json`],
		});
	}
	tasks.push({
		id: 'coverage', dependsOn: NODE_TEST_SHARD_IDS.map((shard: string) => `compact/${shard}`),
		args: [resolve(root, 'scripts/report-local-node-coverage.mjs'), `${CHECK_ALL_NODE_DIRECTORY}/shards`],
	});
	for (let shard = 1; shard <= 4; shard++) {
		tasks.push({
			id: `browser/${shard}`, dependsOn: ['build', interchangePreparation], browser: true,
			args: [resolve(root, 'scripts/run-module-browser-tests.ts'),
				'--config=playwright.check-all.config.ts', `--suite-shard=${shard}/4`, '--workers=2',
				`--output=test-results/check-all/browser-${shard}`],
			env: { SCAPE_CHECK_ALL_SERVERS: '1', SCAPE_BROWSER_COVERAGE: '' },
		});
	}
	return tasks;
}

function npmSteps(command: string | undefined, owner: string): string[] {
	if (!command) throw new Error(`Missing ${owner} script.`);
	return command.split(' && ').map(step => {
		const script = /^npm run ([\w:-]+)$/u.exec(step)?.[1];
		if (!script) throw new Error(`Unsupported ${owner} step: ${step}. Update the check-all plan.`);
		return script;
	});
}
