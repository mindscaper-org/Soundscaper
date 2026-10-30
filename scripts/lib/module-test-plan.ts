/* SPDX-License-Identifier: AGPL-3.0-only */

import { buildModuleGraph, forwardModuleClosure, reverseModuleClosure, type ModuleDependencyGraph, type ModuleSnapshot, type ModuleSpecifierResolver } from './module-dependency-graph.ts';
import { matchesModulePattern, normalizeModulePath, ownerOfModulePath, type ModulePolicy } from './module-policy.ts';

export interface ModuleTestPlanOptions {
	readonly policy: ModulePolicy;
	readonly current: ModuleSnapshot;
	readonly base?: ModuleSnapshot;
	readonly changedPaths: readonly string[];
	readonly nodeTests: readonly string[];
	readonly browserTests: readonly string[];
	readonly modules?: readonly string[];
	readonly requireIndependent?: boolean;
	readonly resolveSpecifier?: ModuleSpecifierResolver;
}

export interface ModuleTestPlan {
	readonly mode: 'focused' | 'full';
	readonly modules: readonly string[];
	readonly nodeTests: readonly string[];
	readonly browserTests: readonly string[];
	readonly products: readonly string[];
	readonly reasons: readonly string[];
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const matches = (file: string, patterns: readonly string[]): boolean => patterns.some(pattern => matchesModulePattern(file, pattern));

/** Select semantic owners before the existing runner partitions execution work. */
export function planModuleTests(options: ModuleTestPlanOptions): ModuleTestPlan {
	const { policy } = options;
	const changed = sorted(options.changedPaths.map(normalizeModulePath));
	const nodeTests = sorted(options.nodeTests.map(normalizeModulePath));
	const browserTests = sorted(options.browserTests.map(normalizeModulePath));
	const modules = new Set(options.modules ?? []);
	const explicit = options.modules !== undefined;
	const reasons: string[] = [];
	const fallbacks: string[] = [];
	const products = new Set<string>();
	const graphOptions = { runtimeInputs: policy.runtimeInputs, resolveSpecifier: options.resolveSpecifier };
	// Explicit module targets need no dependency inference: every declared test
	// runs, including tests whose implementation launches another runtime.
	const graphs = explicit ? [] : [buildModuleGraph(options.current, graphOptions), ...(options.base ? [buildModuleGraph(options.base, graphOptions)] : [])];
	const testInventory = new Set([...nodeTests, ...browserTests,
		...[...options.current.keys(), ...options.base?.keys() ?? []].filter(file => /^tests\/.*\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/u.test(file)),
	]);
	for (const id of modules) if (!policy.modules.some(module => module.id === id)) throw new TypeError(`Unknown module ${id}.`);
	for (const file of changed) {
		if (matches(file, policy.globalInputs)) fallbacks.push(`Global input changed: ${file}.`);
		const owner = ownerOfModulePath(policy, file);
		if (owner) modules.add(owner.id);
		const inputOwners = runtimeOwners(file, policy, options.current, options.base);
		for (const id of inputOwners) modules.add(id);
		const testCoverage = changedTestCoverage(file, policy, graphs, testInventory, owner === undefined);
		for (const id of testCoverage.modules) modules.add(id);
		fallbacks.push(...testCoverage.failures);
		if (testCoverage.modules.length) reasons.push(`Changed test input ${file} requires coverage for ${testCoverage.modules.join(', ')}.`);
		if (!owner && inputOwners.length === 0 && !testCoverage.classified) {
			fallbacks.push(`No module owns changed path ${file}.`);
		}
	}
	const seeds = new Set(changed);
	if (explicit) {
		for (const file of new Set([...options.current.keys(), ...options.base?.keys() ?? []])) {
			const owner = ownerOfModulePath(policy, file);
			if (owner && modules.has(owner.id)) seeds.add(file);
		}
	}
	// A named module is its complete declared target. Dependency expansion is
	// reserved for a change plan, where the changed paths define its impact.
	const affected = new Set(explicit ? [] : graphs.flatMap(graph => [...reverseModuleClosure(graph, seeds)]));
	const selectedNode = new Set(nodeTests.filter(file => affected.has(file)));
	const selectedBrowser = new Set(browserTests.filter(file => affected.has(file)));
	const affectedBrowser = new Set(selectedBrowser);
	for (const module of policy.modules) {
		if (!modules.has(module.id)) continue;
		reasons.push(`Module ${module.id}: complete owner test target.`);
		if ((options.requireIndependent ?? !explicit) && !module.independent) fallbacks.push(`Module ${module.id} still requires the complete coverage union.`);
		for (const file of nodeTests) if (matches(file, module.nodeTests)) selectedNode.add(file);
		for (const file of browserTests) if (matches(file, module.browserTests ?? [])) selectedBrowser.add(file);
		for (const product of module.products) products.add(product);
	}
	for (const target of policy.browserTests ?? []) {
		const targetModules = explicit ? target.modules : moduleDependencies(policy, target.modules);
		const selectedOwner = targetModules.some(id => modules.has(id));
		if (!selectedOwner && !browserTests.some(file => affectedBrowser.has(file) && matches(file, target.files))) continue;
		if (selectedOwner) for (const file of browserTests) if (matches(file, target.files)) selectedBrowser.add(file);
		for (const product of target.products) products.add(product);
	}
	for (const file of changed.filter(file => browserTests.includes(file))) {
		if (!(policy.browserTests ?? []).some(target => matches(file, target.files))
			&& !policy.modules.some(module => matches(file, module.browserTests ?? []))) {
			fallbacks.push(`Browser workflow ${file} has no declared module/product target.`);
		}
	}
	for (const graph of graphs) {
		// A consumer's other dependencies are not automatically affected by a
		// change to one leaf. Follow imports from selected tests and changed
		// sources, while still checking every actual reverse consumer itself.
		const touched = new Set([...affected, ...forwardModuleClosure(graph, [...seeds, ...selectedNode, ...selectedBrowser])]);
		for (const [file, unknown] of graph.unresolved) if (touched.has(file)) {
			for (const detail of unknown) fallbacks.push(`Unresolved dependency in ${file}: ${detail}.`);
		}
	}
	for (const file of selectedNode) if (affected.has(file)) reasons.push(`Affected Node test: ${file}.`);
	for (const file of selectedBrowser) reasons.push(`Relevant browser workflow: ${file}.`);
	if (fallbacks.length) return {
		mode: 'full', modules: sorted(modules), nodeTests, browserTests,
		products: sorted(policy.modules.flatMap(module => [...module.products])), reasons: sorted([...reasons, ...fallbacks]),
	};
	return { mode: 'focused', modules: sorted(modules), nodeTests: sorted(selectedNode), browserTests: sorted(selectedBrowser), products: sorted(products), reasons: sorted(reasons) };
}

function moduleDependencies(policy: ModulePolicy, seeds: readonly string[]): string[] {
	const found = new Set(seeds);
	const pending = [...seeds];
	for (let index = 0; index < pending.length; index++) {
		for (const dependency of policy.modules.find(module => module.id === pending[index])?.dependencies ?? []) {
			if (!found.has(dependency)) { found.add(dependency); pending.push(dependency); }
		}
	}
	return [...found];
}

function testOwners(policy: ModulePolicy, file: string): string[] {
	const owners = new Set<string>();
	for (const module of policy.modules) {
		if (matches(file, module.nodeTests) || matches(file, module.browserTests ?? [])) owners.add(module.id);
	}
	for (const target of policy.browserTests ?? []) if (matches(file, target.files)) {
		for (const id of target.modules) owners.add(id);
	}
	return sorted(owners);
}

/** Test reductions retain their declared coverage obligations even after imports disappear. */
function changedTestCoverage(
	file: string,
	policy: ModulePolicy,
	graphs: readonly ModuleDependencyGraph[],
	testInventory: ReadonlySet<string>,
	includeConsumers: boolean,
): { modules: string[]; failures: string[]; classified: boolean } {
	const ownMembership = testOwners(policy, file);
	const changedTests = testInventory.has(file) || ownMembership.length > 0 ? [file]
		: includeConsumers ? sorted(graphs.flatMap(graph => [...reverseModuleClosure(graph, [file])].filter(candidate => testInventory.has(candidate)))) : [];
	const modules = new Set<string>();
	const failures: string[] = [];
	for (const testFile of changedTests) {
		const owners = testOwners(policy, testFile);
		if (owners.length === 0) failures.push(`No declared coverage owner for changed test input ${file}: ${testFile}.`);
		for (const id of owners) modules.add(id);
	}
	return { modules: sorted(modules), failures, classified: changedTests.length > 0 };
}

function runtimeOwners(file: string, policy: ModulePolicy, current: ModuleSnapshot, base?: ModuleSnapshot): string[] {
	const owners = new Set<string>();
	for (const input of policy.runtimeInputs ?? []) {
		if (!matches(file, input.dependencies)) continue;
		for (const candidate of new Set([...current.keys(), ...base?.keys() ?? []])) {
			if (!matches(candidate, input.files)) continue;
			const owner = ownerOfModulePath(policy, candidate);
			if (owner) owners.add(owner.id);
		}
	}
	return [...owners];
}
