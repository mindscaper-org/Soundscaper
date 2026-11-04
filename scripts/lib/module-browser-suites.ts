/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { partitionModuleTestSuites, type ModuleTestSuite } from './module-test-suites.ts';

export function parseBrowserSuiteShard(args: readonly string[]): { index: number; total: number; args: string[] } | null {
	const values = args.filter(argument => argument.startsWith('--suite-shard='));
	if (!values.length) return null;
	const parts = values.length === 1 ? /^--suite-shard=(\d+)\/(\d+)$/u.exec(values[0]!) : null;
	if (!parts || !Number.isSafeInteger(Number(parts[2])) || Number(parts[2]) > 32
		|| Number(parts[1]) < 1 || Number(parts[1]) > Number(parts[2]) || args.some(argument => /^--shard(?:=|$)/u.test(argument))) {
		throw new TypeError('Select one browser suite shard, index/total, without a native Playwright shard.');
	}
	return { index: Number(parts[1]), total: Number(parts[2]), args: args.filter(argument => argument !== values[0]) };
}

/** Partition only files that the selected browser project actually collected. */
export function browserSuiteFiles(root: string, suites: readonly ModuleTestSuite[], collected: readonly string[], index: number, total: number): string[] {
	const observed = new Set(collected.map(file => resolve(root, file)));
	const selected = suites.filter(suite => suite.runtime === 'browser').map(suite => ({ ...suite,
		files: suite.files.filter(file => observed.has(resolve(root, file))),
	}));
	const known = new Set(selected.flatMap(suite => suite.files.map(file => resolve(root, file))));
	const missing = [...observed].filter(file => !known.has(file));
	if (missing.length) throw new Error(`Collected browser files have no execution suite: ${missing.join(', ')}.`);
	const slots = Array.from({ length: total }, (_, position) => String(position + 1));
	return partitionModuleTestSuites(selected, slots).get(String(index))!;
}

/** Scoped child configuration cannot introduce foreign test paths. */
export function browserSuiteTestMatch(root: string, value: string | undefined, permitted?: readonly string[]): string[] | null {
	if (value === undefined) return null;
	const files: unknown = JSON.parse(value);
	if (!Array.isArray(files) || new Set(files).size !== files.length || files.some(file => typeof file !== 'string'
		|| !/^tests\/browser\/.+\.spec\.[jt]sx?$/u.test(file) || file.includes('\\')
		|| file.split('/').some(part => part === '.' || part === '..')
		|| (permitted !== undefined && !permitted.includes(file)))) throw new Error('Browser execution suite contains invalid test paths.');
	return (files as string[]).map(file => resolve(root, file).replaceAll('\\', '/'));
}
