/* SPDX-License-Identifier: AGPL-3.0-only */

import { buildModuleGraph, type ModuleSnapshot } from './module-dependency-graph.ts';
import { posix } from 'node:path';
import { matchesModulePattern, ownerOfModulePath, type ModulePolicy } from './module-policy.ts';

export interface ModuleTestSuite {
	readonly id: string;
	readonly kind: 'unit' | 'integration';
	readonly runtime: 'node' | 'browser';
	readonly modules: readonly string[];
	readonly files: readonly string[];
	readonly fixtures: readonly string[];
	readonly weights: Readonly<Record<string, number>>;
}

interface SuiteOptions {
	readonly policy: ModulePolicy;
	readonly snapshot: ModuleSnapshot;
	readonly nodeTests: readonly string[];
	readonly browserTests: readonly string[];
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
// These common drivers are fixtures of every workflow, not feature ownership.
// Dependency planning still follows them; edits to them retain every consumer.
const BROWSER_INFRASTRUCTURE = new Set([
	'tests/browser/audio-editor-test-fixtures.js',
	'tests/browser/audio-editor-test-helpers.js',
	'tests/browser/helpers/browser-coverage-fixture.js',
]);

function declaredOwners(policy: ModulePolicy, file: string, browser: boolean): string[] {
	const candidates = browser ? (policy.browserTests ?? []).map(target => ({ patterns: target.files, modules: target.modules }))
		: policy.modules.map(module => ({ patterns: module.nodeTests, modules: [module.id] }));
	let best = -1;
	const owners = new Set<string>();
	for (const row of candidates) for (const pattern of row.patterns) {
		if (!matchesModulePattern(file, pattern)) continue;
		const score = pattern.includes('*') ? pattern.replaceAll('*', '').length : 1_000_000 + pattern.length;
		if (score < best) continue;
		if (score > best) { owners.clear(); best = score; }
		for (const id of row.modules) owners.add(id);
	}
	return sorted(owners);
}

/** Every test is inventoried; helpers propagate ownership up to a source boundary. */
export function buildModuleTestSuites(options: SuiteOptions): ModuleTestSuite[] {
	const { policy, snapshot, nodeTests, browserTests } = options;
	const all = [...nodeTests, ...browserTests];
	if (new Set(all).size !== all.length) throw new Error('The module suite inventory contains duplicate tests.');
	for (const file of all) if (!snapshot.has(file)) throw new Error(`Module suite test is missing: ${file}.`);
	const graph = buildModuleGraph(snapshot, { runtimeInputs: policy.runtimeInputs });
	const suites = new Map<string, { id: string; kind: ModuleTestSuite['kind']; runtime: ModuleTestSuite['runtime'];
		modules: string[]; files: string[]; fixtures: Set<string>; weights: Record<string, number> }>();
	const browsers = new Set(browserTests);
	for (const file of [...all].sort()) {
		const browser = browsers.has(file);
		const owners = new Set(declaredOwners(policy, file, browser));
		const fixtures = new Set<string>();
		const visited = new Set<string>();
		const visit = (path: string, infrastructure: boolean): void => {
			const identity = `${String(infrastructure)}:${path}`;
			if (visited.has(identity)) return;
			visited.add(identity);
			if (path !== file && path.startsWith('tests/')) fixtures.add(path);
			if (!path.startsWith('tests/')) {
				const owner = ownerOfModulePath(policy, path);
				if (owner && !infrastructure) owners.add(owner.id);
				return;
			}
			// Source-admission tests often read paths instead of importing them.
			// These hints only add obligations; import evidence remains authoritative.
			if (!infrastructure && !(browser && BROWSER_INFRASTRUCTURE.has(path))) for (const match of (snapshot.get(path) ?? '').matchAll(
				/['"`]((?:\.{1,2}\/)*(?:src|desktop|native|scripts|functions|handbook|docs|config)\/[^'"`\r\n]+)['"`]/gu,
			)) {
				const reference = match[1]!;
				const candidate = posix.normalize(reference.startsWith('.') ? posix.join(posix.dirname(path), reference) : reference);
				if (candidate === '..' || candidate.startsWith('../')) continue;
				const owner = ownerOfModulePath(policy, candidate);
				if (owner) owners.add(owner.id);
			}
			for (const dependency of graph.dependencies.get(path) ?? []) {
				visit(dependency, infrastructure || (browser && BROWSER_INFRASTRUCTURE.has(path)));
			}
		};
		visit(file, false);
		const modules = sorted(owners);
		const kind = browser || modules.length !== 1 ? 'integration' : 'unit';
		const id = modules.length ? `${kind}/${modules.join('+')}` : 'integration/repository';
		const key = `${browser ? 'browser' : 'node'}:${id}`;
		let suite = suites.get(key);
		if (!suite) {
			suite = { id, kind, runtime: browser ? 'browser' : 'node', modules, files: [], fixtures: new Set(), weights: {} };
			suites.set(key, suite);
		}
		suite.files.push(file);
		for (const fixture of fixtures) suite.fixtures.add(fixture);
		const source = snapshot.get(file)!;
		suite.weights[file] = Math.max(1, source.match(/\btest(?:\.[a-zA-Z]+)?\s*\(/gu)?.length ?? 0) + Math.ceil(source.length / 4096);
	}
	return [...suites.values()].sort((a, b) => `${a.runtime}:${a.id}`.localeCompare(`${b.runtime}:${b.id}`))
		.map(suite => ({ ...suite, fixtures: sorted(suite.fixtures) }));
}

/** Keep declared obligations and add every actual owner and integration consumer. */
export function modulePolicyWithTestSuites(policy: ModulePolicy, suites: readonly ModuleTestSuite[]): ModulePolicy {
	return { ...policy, modules: policy.modules.map(module => ({ ...module,
		nodeTests: sorted([...module.nodeTests, ...suites.filter(suite => suite.runtime === 'node'
			&& (suite.modules.includes(module.id) || (suite.modules.length === 0 && module.id === 'tooling'))).flatMap(suite => suite.files)]),
		browserTests: sorted([...(module.browserTests ?? []), ...suites.filter(suite => suite.runtime === 'browser'
			&& suite.modules.includes(module.id)).flatMap(suite => suite.files)]),
	})) };
}

/** Keep bounded batches from the same semantic suite together, then balance slots. */
export function partitionModuleTestSuites(suites: readonly ModuleTestSuite[], slots: readonly string[]): Map<string, string[]> {
	if (slots.length === 0 || new Set(slots).size !== slots.length) throw new Error('Execution slots must be nonempty and unique.');
	const batches: { id: string; files: string[]; weight: number }[] = [];
	const seen = new Set<string>();
	for (const suite of suites) {
		const files = [...suite.files].sort();
		for (const file of files) {
			if (seen.has(file)) throw new Error(`Test occurs in multiple execution suites: ${file}.`);
			if (!Number.isFinite(suite.weights[file]) || suite.weights[file]! <= 0) throw new Error(`Test has an invalid scheduling weight: ${file}.`);
			seen.add(file);
		}
		const batchSize = suite.runtime === 'browser' ? 4 : 16;
		for (let start = 0; start < files.length; start += batchSize) {
			const batch = files.slice(start, start + batchSize);
			batches.push({ id: `${suite.runtime}:${suite.id}:${batch[0]!}`, files: batch,
				weight: batch.reduce((sum, file) => sum + suite.weights[file]!, 0) });
		}
	}
	const result = new Map(slots.map(id => [id, [] as string[]]));
	const load = new Map(slots.map(id => [id, 0]));
	for (const batch of batches.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))) {
		const slot = [...slots].sort((a, b) => load.get(a)! - load.get(b)! || a.localeCompare(b))[0]!;
		result.get(slot)!.push(...batch.files);
		load.set(slot, load.get(slot)! + batch.weight);
	}
	for (const files of result.values()) files.sort();
	return result;
}
