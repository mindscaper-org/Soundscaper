/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ModuleDefinition {
	readonly id: string;
	readonly sourcePrefixes: readonly string[];
	readonly sourceFiles?: readonly string[];
	readonly publicFiles?: readonly string[];
	readonly dependencies?: readonly string[];
	readonly nodeTests: readonly string[];
	readonly browserTests?: readonly string[];
	readonly products: readonly string[];
	readonly independent: boolean;
	readonly coverageScope?: string;
}

export interface ModuleRuntimeInput {
	readonly files: readonly string[];
	readonly dependencies: readonly string[];
}

export interface ModuleBrowserTarget {
	readonly files: readonly string[];
	readonly modules: readonly string[];
	readonly products: readonly string[];
}

export interface ModulePolicy {
	readonly schemaVersion: 1;
	readonly modules: readonly ModuleDefinition[];
	readonly globalInputs: readonly string[];
	readonly runtimeInputs?: readonly ModuleRuntimeInput[];
	readonly browserTests?: readonly ModuleBrowserTarget[];
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
	return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
	for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`Unknown ${label} field: ${key}.`);
}

export function normalizeModulePath(value: string): string {
	const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
	if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)
		|| normalized.split('/').some(part => part === '..' || part === '.')) {
		throw new TypeError(`Module path must stay relative to the repository: ${value}.`);
	}
	return normalized;
}

function strings(value: unknown, label: string, paths = false): readonly string[] {
	if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || !entry.trim())) {
		throw new TypeError(`${label} must be an array of nonempty strings.`);
	}
	const result = (value as string[]).map(entry => paths ? normalizeModulePath(entry) : entry);
	if (new Set(result).size !== result.length) throw new TypeError(`${label} must not contain duplicates.`);
	return Object.freeze(result);
}

function definition(value: unknown): ModuleDefinition {
	const row = object(value, 'Module');
	fields(row, ['id', 'sourcePrefixes', 'sourceFiles', 'publicFiles', 'dependencies', 'nodeTests', 'browserTests', 'products', 'independent', 'coverageScope'], 'module');
	if (typeof row.id !== 'string' || !/^[a-z][a-z0-9-]*$/u.test(row.id)) throw new TypeError('Every module needs a stable lowercase id.');
	if (row.independent !== undefined && typeof row.independent !== 'boolean') throw new TypeError(`Module ${row.id} independent must be boolean.`);
	if (row.coverageScope !== undefined && (typeof row.coverageScope !== 'string' || !row.coverageScope.trim())) {
		throw new TypeError(`Module ${row.id} coverageScope must be a nonempty string.`);
	}
	return Object.freeze({
		id: row.id,
		sourcePrefixes: strings(row.sourcePrefixes, `${row.id}.sourcePrefixes`, true),
		...(row.sourceFiles === undefined ? {} : { sourceFiles: strings(row.sourceFiles, `${row.id}.sourceFiles`, true) }),
		...(row.publicFiles === undefined ? {} : { publicFiles: strings(row.publicFiles, `${row.id}.publicFiles`, true) }),
		...(row.dependencies === undefined ? {} : { dependencies: strings(row.dependencies, `${row.id}.dependencies`) }),
		nodeTests: strings(row.nodeTests ?? [], `${row.id}.nodeTests`, true),
		...(row.browserTests === undefined ? {} : { browserTests: strings(row.browserTests, `${row.id}.browserTests`, true) }),
		products: strings(row.products ?? [], `${row.id}.products`),
		independent: row.independent === true,
		...(row.coverageScope === undefined ? {} : { coverageScope: row.coverageScope as string }),
	});
}

export function parseModulePolicy(value: unknown): ModulePolicy {
	const row = object(value, 'Module policy');
	fields(row, ['schemaVersion', 'modules', 'globalInputs', 'runtimeInputs', 'browserTests'], 'module policy');
	if (row.schemaVersion !== 1 || !Array.isArray(row.modules) || row.modules.length === 0) {
		throw new TypeError('Module policy needs schemaVersion 1 and a nonempty modules array.');
	}
	const modules = Object.freeze(row.modules.map(definition));
	const ids = new Set(modules.map(module => module.id));
	if (ids.size !== modules.length) throw new TypeError('Module policy declares a module twice.');
	const assertIds = (values: readonly string[]): void => {
		for (const id of values) if (!ids.has(id)) throw new TypeError(`Module policy references unknown module ${id}.`);
	};
	for (const module of modules) assertIds(module.dependencies ?? []);
	if (row.runtimeInputs !== undefined && !Array.isArray(row.runtimeInputs)) throw new TypeError('runtimeInputs must be an array.');
	if (row.browserTests !== undefined && !Array.isArray(row.browserTests)) throw new TypeError('browserTests must be an array.');
	const runtimeInputs = (row.runtimeInputs as unknown[] | undefined)?.map(value => {
		const input = object(value, 'Runtime input');
		fields(input, ['files', 'dependencies'], 'runtime input');
		return Object.freeze({ files: strings(input.files, 'runtime input files', true), dependencies: strings(input.dependencies, 'runtime input dependencies', true) });
	});
	const browserTests = (row.browserTests as unknown[] | undefined)?.map(value => {
		const target = object(value, 'Browser target');
		fields(target, ['files', 'modules', 'products'], 'browser target');
		const targetModules = strings(target.modules, 'browser target modules');
		assertIds(targetModules);
		return Object.freeze({ files: strings(target.files, 'browser target files', true), modules: targetModules, products: strings(target.products, 'browser target products') });
	});
	return Object.freeze({ schemaVersion: 1, modules, globalInputs: strings(row.globalInputs ?? [], 'globalInputs', true),
		...(runtimeInputs === undefined ? {} : { runtimeInputs: Object.freeze(runtimeInputs) }),
		...(browserTests === undefined ? {} : { browserTests: Object.freeze(browserTests) }),
	});
}

export function matchesModulePattern(file: string, pattern: string): boolean {
	file = normalizeModulePath(file);
	pattern = normalizeModulePath(pattern);
	if (pattern.endsWith('/')) return file.startsWith(pattern);
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*\*\//gu, '\u0000').replace(/\*\*/gu, '\u0001').replace(/\*/gu, '[^/]*')
		.replaceAll('\u0000', '(?:.*/)?').replaceAll('\u0001', '.*');
	return new RegExp(`^${escaped}$`, 'u').test(file);
}

export function ownerOfModulePath(policy: ModulePolicy, file: string): ModuleDefinition | undefined {
	file = normalizeModulePath(file);
	let selected: ModuleDefinition | undefined;
	let best = -1;
	for (const module of policy.modules) {
		const exact = module.sourceFiles?.includes(file) ? 1_000_000 + file.length : -1;
		const prefix = Math.max(-1, ...module.sourcePrefixes.filter(candidate => file.startsWith(candidate)).map(candidate => candidate.length));
		const score = Math.max(exact, prefix);
		if (score < 0 || score < best) continue;
		if (score === best && selected?.id !== module.id) throw new TypeError(`Ambiguous module ownership for ${file}.`);
		selected = module;
		best = score;
	}
	return selected;
}
