#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectRepositoryModulePlan, type RepositoryModulePlan } from './lib/check-module-repository.ts';
import { parseModulePolicy } from './lib/module-policy.ts';

export interface ModuleCommandOptions {
	root: string;
	base?: string;
	modules?: string[];
	list: boolean;
	json: boolean;
	ci: boolean;
	output?: string;
}

export function parseModuleCommandArguments(args: readonly string[], defaultRoot: string): ModuleCommandOptions {
	const result: ModuleCommandOptions = { root: defaultRoot, list: false, json: false, ci: false };
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]!;
		if (argument === '--list') result.list = true;
		else if (argument === '--json') result.json = true;
		else if (argument === '--ci') result.ci = true;
		else {
			const [key, inline] = argument.split(/=(.*)/su);
			if (!['--root', '--base', '--module', '--output'].includes(key!)) throw new TypeError(`Unknown module check argument: ${argument}.`);
			const value = inline ?? args[++index];
			if (!value || value.startsWith('--')) throw new TypeError(`Missing value for ${key}.`);
			if (key === '--root') result.root = resolve(value);
			else if (key === '--base') result.base = value;
			else if (key === '--module') result.modules = [...result.modules ?? [], ...value.split(',')];
			else result.output = value;
		}
	}
	if (result.base && result.modules) throw new TypeError('Select --base or --module, not both.');
	return result;
}

function command(root: string, args: string[], environment: NodeJS.ProcessEnv = process.env): void {
	const result = spawnSync(process.execPath, args, { cwd: root, env: environment, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.signal || result.status !== 0) throw new Error(`Module check failed (${result.signal ?? result.status}): ${args.join(' ')}`);
}

function summary(plan: RepositoryModulePlan): string {
	return [
		`${plan.mode === 'full' ? 'Complete repository gate required' : 'Focused module gate'}: ${plan.modules.join(', ') || 'test changes only'}.`,
		`${plan.nodeTests.length} Node files; ${plan.browserTests.length} browser specs; products: ${plan.products.join(', ') || 'none'}.`,
		...plan.reasons.slice(0, 20).map(reason => `  ${reason}`),
		...(plan.reasons.length > 20 ? [`  ${plan.reasons.length - 20} more reasons; use --json for the complete plan.`] : []),
	].join('\n');
}

async function execute(root: string, plan: RepositoryModulePlan): Promise<void> {
	const npmCli = process.env.npm_execpath;
	if (!npmCli) throw new Error('Run module checks through npm.');
	const npm = (script: string): void => command(root, [npmCli, 'run', script]);
	if (plan.mode === 'full') {
		npm('check');
		npm('test:browser');
		return;
	}
	if (plan.nodeTests.length === 0 && plan.browserTests.length === 0 && plan.modules.length === 0) {
		process.stdout.write('No changed test or production inputs.\n');
		return;
	}
	// Static checks remain repository-wide while independent test targets migrate.
	for (const script of ['lint', 'typecheck', 'check:architecture', 'audit:ci']) npm(script);
	const planFile = resolve(root, '.wrangler/module-check-plan.json');
	mkdirSync(dirname(planFile), { recursive: true });
	writeFileSync(planFile, JSON.stringify(plan));
	const rawDirectory = resolve(root, 'coverage/modules/raw');
	rmSync(rawDirectory, { recursive: true, force: true });
	const environment = { ...process.env, SCAPE_MODULE_PLAN: planFile, SCAPE_NODE_TEST_CONCURRENCY: '1' };
	if (plan.nodeTests.length) command(root, [resolve(root, 'scripts/run-node-tests.mjs'), `--coverage-directory=${rawDirectory}`], environment);
	const { runModuleCoverageGate } = await import('./lib/check-module-coverage.ts');
	const policy = parseModulePolicy(JSON.parse(readFileSync(resolve(root, 'config/module-policy.json'), 'utf8')));
	if (plan.modules.length && !runModuleCoverageGate(root, rawDirectory, plan.modules, policy)) throw new Error('Module coverage requirements failed.');
	if (plan.browserTests.length) {
		const { ordinaryBrowserProductSitePlan } = await import('./lib/browser-product-site-plan.mjs');
		const { buildBrowserProductSite } = await import('./lib/browser-product-test-sites.mjs');
		const browserEnvironment = { ...environment, SCAPE_BROWSER_PRODUCTS: plan.products.join(',') };
		const sites = ordinaryBrowserProductSitePlan(browserEnvironment);
		for (const site of sites.sites) await buildBrowserProductSite(site);
		command(root, ['--import', 'tsx', resolve(root, 'scripts/run-module-browser-tests.ts'), '--workers=1'], browserEnvironment);
	}
}

export async function main(args: readonly string[]): Promise<void> {
	const options = parseModuleCommandArguments(args, resolve(import.meta.dirname, '..'));
	const plan = collectRepositoryModulePlan(options.root, { ...(options.base ? { base: options.base } : {}),
		...(options.modules ? { modules: options.modules } : {}), full: options.ci && process.env.GITHUB_EVENT_NAME !== 'pull_request' });
	if (options.output) {
		const file = resolve(options.root, options.output);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify(plan, null, '\t') + '\n');
	}
	process.stdout.write(options.json ? JSON.stringify(plan, null, '\t') + '\n' : summary(plan) + '\n');
	if (options.list || options.json || options.ci) return;
	await execute(options.root, plan);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));
