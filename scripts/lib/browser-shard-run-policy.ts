/* SPDX-License-Identifier: AGPL-3.0-only */

import { basename, isAbsolute, relative, resolve } from 'node:path';

interface BrowserShardOptions {
	readonly project: 'chromium' | 'firefox' | 'webkit';
	readonly shard: string;
	readonly workers: 1 | 2;
	readonly testRoot: string;
	readonly allowEmpty?: boolean;
}
interface BrowserShardRunPolicy {
	readonly workers: 1 | 2;
	readonly retries: 0 | 1;
	readonly collectedTests: number;
	readonly lightscaperTests: number;
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a Playwright list object.');
	return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new TypeError('Expected a Playwright list array.');
	return value;
}
function requireValue(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

/** Select a whole shard's run shape from actual collection, without filtering tests. */
export function browserShardRunPolicy(report: unknown, options: BrowserShardOptions): BrowserShardRunPolicy {
	const match = /^([1-9]\d*)\/([1-9]\d*)$/u.exec(options.shard);
	requireValue(match, 'Invalid browser shard.');
	const current = Number(match[1]), total = Number(match[2]);
	requireValue(Number.isSafeInteger(current) && current <= total && total <= 64, 'Invalid browser shard bounds.');
	requireValue(options.workers === 1 || options.workers === 2, 'Invalid ordinary worker count.');
	const value = object(report), config = object(value.config), shard = object(config.shard);
	requireValue(config.rootDir === resolve(options.testRoot) && config.workers === options.workers
		&& shard.current === current && shard.total === total, 'Collection root, workers or shard differs.');
	const projects = array(config.projects).map(object).filter(project => project.name === options.project);
	requireValue(projects.length === 1 && projects[0]?.retries === 1 && projects[0].repeatEach === 1,
		'Collection must use the selected ordinary CI project with one retry and one repetition.');
	requireValue(array(value.errors).length === 0, 'Playwright collection reported load errors.');
	let collectedTests = 0, lightscaperTests = 0;
	const identities = new Set<string>();
	const visit = (suites: unknown, depth: number): void => {
		requireValue(depth <= 64, 'Playwright collection nesting exceeds its bound.');
		for (const item of array(suites)) {
			const suite = object(item);
			for (const entry of array(suite.specs ?? [])) {
				const spec = object(entry);
				requireValue(typeof spec.file === 'string' && typeof spec.id === 'string' && spec.id.length > 0,
					'Playwright collection has no source identity.');
				const file = resolve(options.testRoot, spec.file), within = relative(options.testRoot, file);
				requireValue(within.length > 0 && !isAbsolute(within) && within !== '..'
					&& !within.startsWith('../') && !within.startsWith('..\\'), 'Collected file escaped its test root.');
				for (const row of array(spec.tests)) {
					const test = object(row), identity = `${spec.id}:${String(test.projectName)}`;
					requireValue(test.projectName === options.project && array(test.results).length === 0,
						'Expected only unexecuted tests from the selected project.');
					requireValue(!identities.has(identity), 'Duplicate collected test identity.');
					identities.add(identity); collectedTests++;
					requireValue(collectedTests <= 20_000, 'Playwright collection exceeds its test bound.');
					if (basename(file).startsWith('lightscaper-')) lightscaperTests++;
				}
			}
			visit(suite.suites ?? [], depth + 1);
		}
	};
	visit(value.suites, 0);
	requireValue(collectedTests > 0 || options.allowEmpty === true, 'The browser shard collected no tests.');
	return { workers: lightscaperTests ? 1 : options.workers, retries: lightscaperTests ? 0 : 1,
		collectedTests, lightscaperTests };
}
