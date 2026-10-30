#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readModuleExecutionPlan } from './lib/check-module-repository.ts';

interface BrowserCollection {
	readonly testCount: number;
	readonly files: readonly string[];
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Playwright collection ${label} is invalid.`);
	return value as Record<string, unknown>;
}

function rows(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`Playwright collection ${label} must be an array.`);
	return value;
}

/** Empty shard reports are valid; collection errors and malformed reports are not. */
export function analyzeModuleBrowserCollection(value: unknown): BrowserCollection {
	const report = record(value, 'report');
	if (report.errors !== undefined && rows(report.errors, 'errors').length) {
		throw new Error(`Playwright test collection failed: ${JSON.stringify(report.errors)}`);
	}
	const config = record(report.config, 'configuration');
	if (typeof config.rootDir !== 'string' || !config.rootDir) throw new Error('Playwright collection has no test root.');
	const root = config.rootDir;
	const files = new Set<string>();
	let testCount = 0;
	const visit = (value: unknown): void => {
		const suite = record(value, 'suite');
		for (const value of rows(suite.specs ?? [], 'specs')) {
			const spec = record(value, 'spec');
			const count = rows(spec.tests, 'tests').length;
			if (count === 0) continue;
			const file = spec.file ?? suite.file;
			if (typeof file !== 'string' || !file) throw new Error('Playwright collection has a test without a file.');
			files.add(resolve(root, file));
			testCount += count;
		}
		for (const child of rows(suite.suites ?? [], 'suites')) visit(child);
	};
	for (const suite of rows(report.suites, 'suites')) visit(suite);
	return { testCount, files: [...files].sort() };
}

export function moduleBrowserListArguments(args: readonly string[], unsharded: boolean): string[] {
	const result = ['test'];
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]!;
		if (argument === '--list') continue;
		if (argument === '--reporter' || (unsharded && argument === '--shard')) {
			if (args[index + 1] === undefined || args[index + 1]!.startsWith('--')) throw new TypeError(`Missing value for ${argument}.`);
			index++;
			continue;
		}
		if (argument.startsWith('--reporter=') || (unsharded && argument.startsWith('--shard='))) continue;
		result.push(argument);
	}
	return [...result, '--list', '--reporter=json'];
}

function collect(root: string, args: readonly string[], environment: NodeJS.ProcessEnv): BrowserCollection {
	const result = spawnSync(process.execPath, [resolve(root, 'node_modules/@playwright/test/cli.js'), ...args], {
		cwd: root, env: environment, encoding: 'utf8', maxBuffer: 32 * 1024 ** 2, timeout: 60_000,
	});
	if (result.error) throw new Error('Playwright collection could not start.', { cause: result.error });
	if (result.status !== 0 || result.signal) throw new Error(`Playwright collection failed (${result.signal ?? result.status}): ${result.stderr || result.stdout}`);
	let report: unknown;
	try { report = JSON.parse(result.stdout); }
	catch (error) { throw new Error('Playwright collection returned invalid JSON.', { cause: error }); }
	return analyzeModuleBrowserCollection(report);
}

function skip(root: string, environment: NodeJS.ProcessEnv): number {
	if (environment.SCAPE_BROWSER_COVERAGE === '1') {
		const directory = resolve(root, 'coverage/v8-browser');
		mkdirSync(directory, { recursive: true });
		writeFileSync(resolve(directory, 'empty-module-selection.json'), JSON.stringify({ result: [] }) + '\n');
	}
	process.stdout.write('No browser cases were assigned to this module-selection shard.\n');
	return 0;
}

/** Preserve ordinary runs and only admit empty shards from a validated focused plan. */
export function runModuleBrowserTests(root: string, args: readonly string[], environment: NodeJS.ProcessEnv = process.env): number {
	const plan = environment.SCAPE_MODULE_PLAN ? readModuleExecutionPlan(root, environment.SCAPE_MODULE_PLAN) : undefined;
	if (plan?.mode === 'focused') {
		if (plan.browserTests.length === 0) return skip(root, environment);
		if (args.some(argument => argument === '--pass-with-no-tests' || argument.startsWith('--pass-with-no-tests='))) throw new TypeError('Focused browser runs do not accept --pass-with-no-tests.');
		const all = collect(root, moduleBrowserListArguments(args, true), environment);
		const observed = new Set(all.files);
		const missing = plan.browserTests.filter(file => !observed.has(resolve(root, file)));
		if (all.testCount === 0 || missing.length) throw new Error(`The selected browser workflows were not collected: ${missing.join(', ') || 'no cases'}.`);
		const shard = collect(root, moduleBrowserListArguments(args, false), environment);
		if (shard.testCount === 0) return skip(root, environment);
	}
	const result = spawnSync(process.execPath, [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', ...args], {
		cwd: root, env: environment, stdio: 'inherit',
	});
	if (result.error) throw result.error;
	if (result.signal) throw new Error(`Playwright test execution terminated with ${result.signal}.`);
	return result.status ?? 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	process.exitCode = runModuleBrowserTests(resolve(import.meta.dirname, '..'), process.argv.slice(2));
}
