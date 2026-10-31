/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseModulePolicy } from './module-policy.ts';
import { planModuleTests } from './module-test-plan.ts';
import { PRODUCT_STAND_IN_ALIASES } from './product-aliases.mjs';
import { buildModuleTestSuites, modulePolicyWithTestSuites } from './module-test-suites.ts';

const SOURCE = /\.(?:[cm]?[jt]sx?)$/u;
const NODE_TEST = /^tests\/[^/]+\.test\.(?:[cm]?[jt]s|[jt]sx)$/u;
const BROWSER_TEST = /^tests\/browser\/(?!handbook\/|dual-origin\/|audiocity\/).*\.spec\.[jt]sx?$/u;
const MAX_GIT_OUTPUT = 512 * 1024 ** 2;

export type RepositoryModulePlan = ReturnType<typeof planModuleTests> & {
	readonly schemaVersion: 1;
	readonly revision: string;
	readonly comparisonRevision: string | null;
	readonly sourceFingerprint: string;
};

export interface RepositoryModuleOptions {
	readonly base?: string;
	readonly modules?: readonly string[];
	readonly full?: boolean;
}

function git(root: string, args: string[]): string {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT, stdio: ['pipe', 'pipe', 'pipe'] });
}

function paths(value: string): string[] { return value.split('\0').filter(Boolean); }

function streamedDigest(file: string, expectedBytes: number, buffer: Buffer): string {
	const digest = createHash('sha256');
	const descriptor = openSync(file, 'r');
	let length = 0;
	try {
		for (;;) {
			const bytes = readSync(descriptor, buffer, 0, buffer.byteLength, null);
			if (bytes === 0) break;
			digest.update(buffer.subarray(0, bytes));
			length += bytes;
		}
	} finally { closeSync(descriptor); }
	if (length !== expectedBytes) throw new Error(`The source inputs changed while fingerprinting ${file}.`);
	return digest.digest('hex');
}

/** Read graph source and fingerprint it from the same bytes, with bounded binary reads. */
function currentModuleState(root: string, retainSources: boolean, fingerprint: boolean): {
	snapshot: ReadonlyMap<string, string>; sourceFingerprint: string;
} {
	const files = [...new Set(paths(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])))].sort();
	const result = new Map<string, string>();
	const digest = fingerprint ? createHash('sha256').update('scape-module-sources-v1\n') : null;
	const buffer = fingerprint ? Buffer.allocUnsafe(1024 * 1024) : null;
	for (const file of files) {
		try {
			const absolute = resolve(root, file);
			const stats = statSync(absolute);
			if (!stats.isFile()) {
				digest?.update(JSON.stringify([file, 'not-file']) + '\n');
				continue;
			}
			const source = retainSources && (SOURCE.test(file) || file === 'config/module-policy.json') ? readFileSync(absolute) : null;
			const fileDigest = digest && buffer ? (source ? createHash('sha256').update(source).digest('hex')
				: streamedDigest(absolute, stats.size, buffer)) : null;
			result.set(file, source?.toString('utf8') ?? '');
			digest?.update(JSON.stringify([file, 'file', fileDigest]) + '\n');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			digest?.update(JSON.stringify([file, 'missing']) + '\n');
		}
	}
	return { snapshot: result, sourceFingerprint: digest?.digest('hex') ?? '' };
}

/** Binary assets remain graph inputs without retaining their bytes in memory. */
export function currentModuleSnapshot(root: string): ReadonlyMap<string, string> {
	return currentModuleState(root, true, false).snapshot;
}

/** Portable source identity includes uncommitted inputs, never ignored build/cache output. */
export function currentModuleSourceFingerprint(root: string): string {
	return currentModuleState(root, false, true).sourceFingerprint;
}

/** One batch avoids starting a Git process for each source in the base graph. */
export function revisionModuleSnapshot(root: string, revision: string): ReadonlyMap<string, string> {
	const records = paths(git(root, ['ls-tree', '-rz', revision])).flatMap(row => {
		const entry = /^\d+ blob ([0-9a-f]+)\t([\s\S]+)$/u.exec(row);
		return entry ? [{ hash: entry[1], file: entry[2] }] : [];
	});
	const result = new Map(records.map(({ file }) => [file, '']));
	const sources = records.filter(({ file }) => SOURCE.test(file));
	if (sources.length === 0) return result;
	const bytes = execFileSync('git', ['cat-file', '--batch'], { cwd: root,
		input: sources.map(({ hash }) => hash).join('\n') + '\n', maxBuffer: MAX_GIT_OUTPUT });
	let offset = 0;
	for (const { file } of sources) {
		const end = bytes.indexOf(10, offset);
		const header = /^[0-9a-f]+ blob (\d+)$/u.exec(bytes.toString('utf8', offset, end));
		if (end < 0 || !header) throw new Error(`Cannot read the comparison source ${file}.`);
		const length = Number(header[1]);
		result.set(file, bytes.toString('utf8', end + 1, end + 1 + length));
		offset = end + length + 2;
	}
	return result;
}

export function collectRepositoryModulePlan(root: string, options: RepositoryModuleOptions = {}): RepositoryModulePlan {
	const { snapshot: current, sourceFingerprint } = currentModuleState(root, true, true);
	let policy = parseModulePolicy(JSON.parse(current.get('config/module-policy.json') ?? 'null'));
	const nodeTests = [...current.keys()].filter(file => NODE_TEST.test(file)).sort();
	const browserTests = [...current.keys()].filter(file => BROWSER_TEST.test(file)).sort();
	const revision = git(root, ['rev-parse', 'HEAD']).trim();
	let comparisonRevision: string | null = null;
	let base: ReadonlyMap<string, string> | undefined;
	let changedPaths: string[] = [];
	let failure: string | undefined;
	if (!options.modules && !options.full) {
		try {
			comparisonRevision = git(root, ['merge-base', options.base ?? 'main', 'HEAD']).trim();
			base = revisionModuleSnapshot(root, comparisonRevision);
			changedPaths = [...new Set([
				...paths(git(root, ['diff', '--name-only', '--no-renames', '-z', comparisonRevision, '--'])),
				...paths(git(root, ['ls-files', '--others', '--exclude-standard', '-z'])),
			])].sort();
		} catch {
			comparisonRevision = null;
			failure = `Comparison revision ${options.base ?? 'main'} is unavailable; running the complete gate.`;
		}
	}
	// The conservative union includes the default implementation and every
	// browser/desktop product replacement, using the build's canonical table.
	const suites = buildModuleTestSuites({ policy, snapshot: current, nodeTests, browserTests });
	if (base) suites.push(...buildModuleTestSuites({ policy, snapshot: base,
		nodeTests: [...base.keys()].filter(file => NODE_TEST.test(file)),
		browserTests: [...base.keys()].filter(file => BROWSER_TEST.test(file)) }));
	policy = modulePolicyWithTestSuites(policy, suites);
	const planningPolicy = { ...policy, runtimeInputs: [...policy.runtimeInputs ?? [], ...PRODUCT_STAND_IN_ALIASES.flatMap(row => (
		row.sourcePaths.filter(source => source !== row.standIn).map(source => ({ files: [source], dependencies: [row.standIn] }))
	))] };
	const planned = planModuleTests({ policy: planningPolicy, current, ...(base ? { base } : {}), changedPaths, nodeTests, browserTests,
		...(options.modules ? { modules: options.modules } : {}) });
	return { ...planned,
		...((failure || options.full) ? { mode: 'full' as const, modules: policy.modules.map(module => module.id), nodeTests, browserTests,
			products: [...new Set(policy.modules.flatMap(module => module.products))].sort(),
			reasons: [failure ?? 'The complete gate was explicitly requested.'] } : {}),
		schemaVersion: 1, revision, comparisonRevision, sourceFingerprint };
}

/** Execution consumes only a plan for this checkout and known test files. */
export function readModuleExecutionPlan(root: string, file: string): RepositoryModulePlan {
	const value = JSON.parse(readFileSync(resolve(root, file), 'utf8')) as RepositoryModulePlan;
	if (value.schemaVersion !== 1 || !['focused', 'full'].includes(value.mode)
		|| value.revision !== git(root, ['rev-parse', 'HEAD']).trim()) throw new Error('The module plan names the wrong source revision.');
	const { snapshot: inventory, sourceFingerprint } = currentModuleState(root, false, true);
	if (typeof value.sourceFingerprint !== 'string' || !/^[0-9a-f]{64}$/u.test(value.sourceFingerprint)
		|| value.sourceFingerprint !== sourceFingerprint) throw new Error('The module plan source fingerprint does not match the current source inputs.');
	for (const [files, pattern] of [[value.nodeTests, NODE_TEST], [value.browserTests, BROWSER_TEST]] as const) {
		if (!Array.isArray(files) || new Set(files).size !== files.length
			|| files.some(path => typeof path !== 'string' || !pattern.test(path) || !inventory.has(path))) {
			throw new Error('The module plan contains an invalid or missing test path.');
		}
	}
	const policy = parseModulePolicy(JSON.parse(readFileSync(resolve(root, 'config/module-policy.json'), 'utf8')));
	if (!Array.isArray(value.modules) || value.modules.some(id => !policy.modules.some(module => module.id === id))) {
		throw new Error('The module plan names an unknown module.');
	}
	return value;
}
