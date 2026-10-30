#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { runCoverageGate } from './lib/coverage-gate-runner.mjs';
import { NODE_TEST_SHARD_IDS } from './lib/node-test-shards.mjs';

const root = resolve(import.meta.dirname, '..');
const shardDirectory = process.argv[2] ?? 'coverage/shards';

// c8 reports an empty temp directory as 0% — or, with --merge-async, as a yargs
// usage dump with a TypeError buried in it. Either way a shard that never handed
// its coverage over reads as a catastrophic regression rather than the missing
// artifact it is, so say so plainly before the thresholds are applied.
const missing = NODE_TEST_SHARD_IDS.filter((shard) => {
	const file = resolve(root, shardDirectory, `${shard}.json`);
	return !existsSync(file) || statSync(file).size === 0;
});

if (missing.length > 0) {
	process.stderr.write(
		`${shardDirectory} is missing usable coverage for: ${missing.join(', ')}. `
		+ 'Every test shard must upload its compacted profile before the thresholds can be checked.\n',
	);
	process.exit(1);
}

const { parseModulePolicy } = await import('./lib/module-policy.ts');
const { runModuleCoverageGate } = await import('./lib/check-module-coverage.ts');
const policy = parseModulePolicy(JSON.parse(readFileSync(resolve(root, 'config/module-policy.json'), 'utf8')));

function completeCoverageGate() {
	if (!runCoverageGate(root, shardDirectory)) return false;
	const independent = policy.modules.filter(module => module.independent).map(module => module.id);
	return independent.length === 0 || runModuleCoverageGate(root, shardDirectory, independent, policy);
}

if (process.env.SCAPE_MODULE_PLAN) {
	const { readModuleExecutionPlan } = await import('./lib/check-module-repository.ts');
	const plan = readModuleExecutionPlan(root, process.env.SCAPE_MODULE_PLAN);
	if (plan.mode === 'focused') {
		for (const id of plan.modules) {
			if (!policy.modules.find(module => module.id === id)?.independent) throw new Error(`Module ${id} requires the complete coverage union.`);
		}
		process.exitCode = plan.modules.length === 0 || runModuleCoverageGate(root, shardDirectory, plan.modules, policy) ? 0 : 1;
	} else process.exitCode = completeCoverageGate() ? 0 : 1;
} else process.exitCode = completeCoverageGate() ? 0 : 1;
