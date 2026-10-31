#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browserShardRunPolicy } from './lib/browser-shard-run-policy.ts';
import { readModuleExecutionPlan } from './lib/check-module-repository.ts';

const [reportPath, project, shard, normalWorkers] = process.argv.slice(2);
if (process.argv.length !== 6 || !reportPath || !project || !shard || !['chromium', 'firefox', 'webkit'].includes(project)
	|| (normalWorkers !== '1' && normalWorkers !== '2')) {
	throw new Error('Expected collection JSON, browser project, shard and ordinary worker count.');
}
const info = await lstat(reportPath);
if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 32 * 1024 * 1024) {
	throw new Error('Expected bounded regular browser collection JSON.');
}
const report: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
const modulePlan = process.env.SCAPE_MODULE_PLAN
	? readModuleExecutionPlan(process.cwd(), process.env.SCAPE_MODULE_PLAN) : undefined;
const policy = browserShardRunPolicy(report, { project: project as 'chromium' | 'firefox' | 'webkit', shard,
	workers: normalWorkers === '1' ? 1 : 2, testRoot: resolve('tests/browser'),
	allowEmpty: modulePlan?.mode === 'focused' });
// Only finite primitive values reach GITHUB_OUTPUT. Keep the source list available for diagnostics.
process.stderr.write(`Browser shard ${project} ${shard}: ${String(policy.collectedTests)} collected, ${String(policy.lightscaperTests)} Lightscaper; workers=${String(policy.workers)}, retries=${String(policy.retries)}.\n`);
process.stdout.write(`workers=${String(policy.workers)}\nretries=${String(policy.retries)}\n`);
