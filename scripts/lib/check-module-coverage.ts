/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { COVERAGE_SCOPES, classifyProductionCoveragePath, loadCoverageScopes } from './coverage-gates.mjs';
import { normalizeDuplicateFunctionCoverage } from './coverage-function-normalization.mjs';
import { matchesModulePattern, normalizeModulePath, ownerOfModulePath, type ModuleDefinition, type ModulePolicy } from './module-policy.ts';

const METRICS = ['lines', 'branches', 'functions'] as const;
const SOURCE = /(?<!\.d)\.(?:[cm]?[jt]sx?)$/u;
type Metric = (typeof METRICS)[number];

interface MetricCounts { covered: number; total: number; percentage: number }
interface CoverageScope {
	readonly id: string;
	readonly thresholds: Readonly<Record<string, number>>;
}

export interface ModuleCoverageScope {
	readonly moduleId: string;
	readonly scopeId: string;
	readonly thresholds: Readonly<Record<string, number>>;
	readonly files: string[];
	readonly metrics: Record<Metric, MetricCounts>;
}

export interface ModuleCoverageAnalysis {
	readonly scopes: readonly ModuleCoverageScope[];
	readonly failures: readonly string[];
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
	return value as Record<string, unknown>;
}

function selectedModules(policy: ModulePolicy, ids: readonly string[]): readonly ModuleDefinition[] {
	if (ids.length === 0) throw new Error('Module coverage requires at least one module.');
	return [...new Set(ids)].map(id => {
		const module = policy.modules.find(candidate => candidate.id === id);
		if (!module) throw new Error(`Unknown module coverage target: ${id}.`);
		return module;
	});
}

function coveragePath(root: string, file: string): string {
	return normalizeModulePath(isAbsolute(file) ? relative(root, file) : file);
}

function count(value: unknown, metric: Metric, file: string): { covered: number; total: number } {
	const candidate = record(value, `Coverage for ${file}`)[metric];
	if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
		throw new TypeError(`Coverage has an invalid ${metric} count for ${file}.`);
	}
	const entry = candidate as Record<string, unknown>;
	const { covered, total } = entry;
	if (!Number.isSafeInteger(covered) || !Number.isSafeInteger(total) || Number(covered) < 0
		|| Number(total) < 0 || Number(covered) > Number(total)) throw new TypeError(`Coverage has an invalid ${metric} count for ${file}.`);
	return { covered: Number(covered), total: Number(total) };
}

/** Evaluate only complete module denominators, keeping each inherited coverage cohort separate. */
export function analyzeModuleCoverage(
	summary: unknown,
	root: string,
	policy: ModulePolicy,
	moduleIds: readonly string[],
	sourceInventory: readonly string[],
	coverageScopes: readonly CoverageScope[] = COVERAGE_SCOPES,
): ModuleCoverageAnalysis {
	const selected = selectedModules(policy, moduleIds);
	const ids = new Set(selected.map(module => module.id));
	const expected = new Map<string, ModuleDefinition>();
	for (const path of sourceInventory) {
		const file = normalizeModulePath(path);
		if (!SOURCE.test(file)) continue;
		const owner = ownerOfModulePath(policy, file);
		if (owner && ids.has(owner.id)) expected.set(file, owner);
	}
	const failures: string[] = [];
	for (const module of selected) {
		if (![...expected.values()].some(owner => owner.id === module.id)) failures.push(`${module.id} has no production source inventory.`);
	}
	const reported = new Map<string, unknown>();
	for (const [path, value] of Object.entries(record(summary, 'Module coverage summary'))) {
		if (path === 'total') continue;
		const file = coveragePath(root, path);
		if (reported.has(file)) throw new Error(`Module coverage reports a duplicate source: ${file}.`);
		reported.set(file, value);
		if (!expected.has(file)) failures.push(`Module coverage reports an unexpected source ${file}.`);
	}
	const scopes = new Map<string, ModuleCoverageScope>();
	for (const [file, owner] of expected) {
		const scopeId = owner.coverageScope ?? classifyProductionCoveragePath(file);
		const budget = coverageScopes.find(scope => scope.id === scopeId);
		if (!budget) throw new Error(`${owner.id} has no inherited coverage budget for ${file}.`);
		const key = `${owner.id}/${budget.id}`;
		let scope = scopes.get(key);
		if (!scope) {
			scope = { moduleId: owner.id, scopeId: budget.id, thresholds: budget.thresholds, files: [], metrics: {
				lines: { covered: 0, total: 0, percentage: 100 }, branches: { covered: 0, total: 0, percentage: 100 },
				functions: { covered: 0, total: 0, percentage: 100 },
			} };
			scopes.set(key, scope);
		}
		scope.files.push(file);
		if (!reported.has(file)) { failures.push(`${owner.id} is missing coverage for ${file}.`); continue; }
		for (const metric of METRICS) {
			const counts = count(reported.get(file), metric, file);
			scope.metrics[metric].covered += counts.covered;
			scope.metrics[metric].total += counts.total;
		}
	}
	for (const scope of scopes.values()) {
		for (const metric of METRICS) {
			const counts = scope.metrics[metric];
			counts.percentage = counts.total === 0 ? 100 : 100 * counts.covered / counts.total;
			const threshold = scope.thresholds[metric];
			if (threshold === undefined || !Number.isFinite(threshold)) throw new Error(`Missing ${metric} coverage budget for ${scope.scopeId}.`);
			if (counts.percentage < threshold) failures.push(
				`${scope.moduleId}/${scope.scopeId} ${metric} coverage is ${counts.percentage.toFixed(2)}% `
				+ `(${counts.covered}/${counts.total}), below ${threshold}%.`,
			);
		}
	}
	return { scopes: [...scopes.values()], failures };
}

function assertProfiles(directory: string): void {
	if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Error(`Module coverage directory is missing: ${directory}.`);
	const files = readdirSync(directory).filter(file => file.endsWith('.json'));
	if (files.length === 0) throw new Error(`Module coverage directory is empty: ${directory}.`);
	let usable = false;
	for (const file of files) {
		const profile = record(JSON.parse(readFileSync(join(directory, file), 'utf8')) as unknown, `V8 profile ${file}`);
		if (!Array.isArray(profile.result)) throw new Error(`Module coverage profile ${file} has no usable V8 evidence.`);
		if (profile.result.length > 0) usable = true;
	}
	if (!usable) throw new Error('Module coverage contains no usable V8 evidence.');
}

function sourceFiles(root: string): readonly string[] {
	const configPath = resolve(root, '.c8rc.json');
	const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) as { include?: string[]; exclude?: string[] } : {};
	const include = config.include ?? ['src/', 'desktop/'];
	return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
		cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 ** 2,
	}).split('\0').filter(file => file && SOURCE.test(file) && existsSync(resolve(root, file))
		&& include.some(pattern => matchesModulePattern(file, pattern))
		&& !(config.exclude ?? []).some(pattern => matchesModulePattern(file, pattern)));
}

/** Tooling and handbook suites have no sources in the shipped-code denominator. */
export function productionModuleCoverageTargets(policy: ModulePolicy, ids: readonly string[]): string[] {
	return selectedModules(policy, ids).filter(module => module.coverageScope !== undefined
		|| [...module.sourcePrefixes, ...module.sourceFiles ?? []].some(path => /^(?:src|desktop)\//u.test(path))).map(module => module.id);
}

/** Report fresh raw or compacted V8 inputs; c8 --all keeps unexecuted owned sources in the gate. */
export function runModuleCoverageGate(root: string, rawDirectory: string, moduleIds: readonly string[], policy: ModulePolicy): boolean {
	root = resolve(root);
	rawDirectory = resolve(root, rawDirectory);
	assertProfiles(rawDirectory);
	const selected = new Set(selectedModules(policy, moduleIds).map(module => module.id));
	const inventory = sourceFiles(root);
	const included = inventory.filter(file => {
		const owner = ownerOfModulePath(policy, file);
		return owner !== undefined && selected.has(owner.id);
	});
	if (included.length === 0 || [...selected].some(id => !included.some(file => ownerOfModulePath(policy, file)?.id === id))) {
		throw new Error('Module coverage requires a nonempty production source inventory for every selected module.');
	}
	const outputRoot = resolve(root, 'coverage');
	mkdirSync(outputRoot, { recursive: true });
	const reportDirectory = mkdtempSync(join(outputRoot, 'module-report-'));
	const reportEnvironment = { ...process.env };
	delete reportEnvironment.NODE_V8_COVERAGE;
	const result = spawnSync(process.execPath, [resolve(root, 'node_modules/c8/bin/c8.js'), 'report', '--all', '--exclude-after-remap',
		`--temp-directory=${rawDirectory}`, `--reports-dir=${reportDirectory}`, '--reporter=json-summary', '--reporter=json',
		...included.flatMap(file => ['--include', file]),
	], { cwd: root, stdio: 'inherit', env: reportEnvironment });
	if (result.error) throw result.error;
	if (result.signal || result.status !== 0) throw new Error(`Module coverage reporting failed: ${result.signal ?? String(result.status)}.`);
	const summary = JSON.parse(readFileSync(join(reportDirectory, 'coverage-summary.json'), 'utf8')) as unknown;
	const detailed = JSON.parse(readFileSync(join(reportDirectory, 'coverage-final.json'), 'utf8')) as unknown;
	const normalized: unknown = normalizeDuplicateFunctionCoverage(summary, detailed);
	const analysis = analyzeModuleCoverage(normalized, root, policy, moduleIds, inventory,
		loadCoverageScopes(resolve(root, 'config/coverage-gates.json')));
	for (const scope of analysis.scopes) process.stdout.write(`${scope.moduleId}/${scope.scopeId}: `
		+ METRICS.map(metric => `${metric} ${scope.metrics[metric].percentage.toFixed(2)}%`).join(', ') + '\n');
	for (const failure of analysis.failures) process.stderr.write(`${failure}\n`);
	return analysis.failures.length === 0;
}
