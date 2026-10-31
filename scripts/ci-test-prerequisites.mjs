#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectTestDependencies } from './lib/node-test-bootstrap.mjs';
import { parseNodeTestSelection, selectNodeTestFiles } from './lib/node-test-shards.mjs';

const INTERCHANGE_READERS = [
	'tests/helpers/interchange-reference.ts',
	'tests/helpers/interchange-top-clip.ts',
	'tests/audio-editor-dawproject-reference-conformance.test.ts',
];

export function interchangeRequiredForTests(repositoryRoot, files) {
	const dependencies = collectTestDependencies(repositoryRoot, files, { testHelpersOnly: true });
	return INTERCHANGE_READERS.some(file => dependencies.has(resolve(repositoryRoot, file)));
}

export function selectedBrowserTestFiles(report) {
	if (report.errors?.length) throw new Error(`Playwright test collection failed: ${JSON.stringify(report.errors)}`);
	if (typeof report.config?.rootDir !== 'string') throw new Error('Playwright test collection has no test root.');
	const files = new Set();
	const visit = suite => {
		for (const spec of suite.specs ?? []) {
			if (spec.tests?.length) files.add(resolve(report.config.rootDir, spec.file ?? suite.file));
		}
		for (const child of suite.suites ?? []) visit(child);
	};
	for (const suite of report.suites ?? []) visit(suite);
	return [...files].sort();
}

function selectedFiles(repositoryRoot, argv) {
	const node = argv.find(argument => argument.startsWith('--node-shard='));
	if (node !== undefined) {
		if (argv.length !== 1) throw new Error('Node prerequisite selection accepts only --node-shard.');
		return selectNodeTestFiles(repositoryRoot, parseNodeTestSelection([node.replace('--node-shard=', '--shard=')]));
	}
	const project = argv.find(argument => argument.startsWith('--project='))?.slice('--project='.length);
	const shard = argv.find(argument => argument.startsWith('--shard='))?.slice('--shard='.length);
	const parts = /^(\d+)\/(\d+)$/u.exec(shard ?? '');
	if (argv.length !== 2 || !['chromium', 'webkit', 'firefox'].includes(project)
		|| !parts || Number(parts[1]) < 1 || Number(parts[1]) > Number(parts[2])) {
		throw new Error('Browser prerequisite selection requires --project and a valid --shard=index/total.');
	}
	const result = spawnSync(process.execPath, [
		resolve(repositoryRoot, 'node_modules/@playwright/test/cli.js'), 'test', '--list', '--reporter=json',
		`--project=${project}`, `--shard=${shard}`,
	], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 32 * 1024 ** 2, timeout: 60_000 });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Playwright prerequisite collection failed: ${result.stderr || result.stdout}`);
	return selectedBrowserTestFiles(JSON.parse(result.stdout));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	const repositoryRoot = resolve(import.meta.dirname, '..');
	console.log(`interchange=${String(interchangeRequiredForTests(repositoryRoot, selectedFiles(repositoryRoot, process.argv.slice(2))))}`);
}
