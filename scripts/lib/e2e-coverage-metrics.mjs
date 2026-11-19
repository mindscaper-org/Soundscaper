/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalJson as stableJson } from './canonical-json.mjs';
import { sha256Digest as digest } from './e2e-coverage-integrity.mjs';

export const E2E_COVERAGE_METRICS = Object.freeze([
	'lines',
	'statements',
	'functions',
	'branches',
]);

export function normalizedFileCoverage(path, value) {
	assertObject(value, `Coverage for ${path}`);
	const maps = {
		statementMap: coverageMap(value.statementMap, value.s, `${path} statements`),
		fnMap: coverageMap(value.fnMap, value.f, `${path} functions`),
		branchMap: coverageMap(value.branchMap, value.b, `${path} branches`, true),
	};
	const coverage = {
		path,
		statementMap: maps.statementMap.map,
		fnMap: maps.fnMap.map,
		branchMap: maps.branchMap.map,
		s: maps.statementMap.counts,
		f: maps.fnMap.counts,
		b: maps.branchMap.counts,
	};
	return {
		coverage,
		mapDigest: digest(Buffer.from(stableJson({
			statementMap: coverage.statementMap,
			fnMap: coverage.fnMap,
			branchMap: coverage.branchMap,
		}))),
	};
}

function coverageMap(map, counters, label, branches = false) {
	assertObject(map, `${label} map`);
	assertObject(counters, `${label} counters`);
	const mapKeys = Object.keys(map).sort();
	const counterKeys = Object.keys(counters).sort();
	if (stableJson(mapKeys) !== stableJson(counterKeys)) throw new Error(`${label} map and counters differ.`);
	for (const key of counterKeys) {
		const counts = branches ? counters[key] : [counters[key]];
		if (!Array.isArray(counts) || counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
			throw new TypeError(`${label} has an invalid counter.`);
		}
		if (branches && (!Array.isArray(map[key]?.locations) || map[key].locations.length !== counts.length)) {
			throw new Error(`${label} locations and counters differ.`);
		}
	}
	return { map, counts: structuredClone(counters) };
}

export function mergeCounters(target, incoming) {
	for (const [metric, name] of [['s', 'statementMap'], ['f', 'fnMap']]) {
		for (const key of Object.keys(target[name])) target[metric][key] += incoming[metric][key];
	}
	for (const key of Object.keys(target.branchMap)) {
		target.b[key] = target.b[key].map((count, index) => count + incoming.b[key][index]);
	}
}

export function summarizeCoverage(files) {
	const totals = Object.fromEntries(E2E_COVERAGE_METRICS.map((metric) => [metric, { covered: 0, total: 0 }]));
	for (const file of files) {
		const lines = new Map();
		for (const [key, count] of Object.entries(file.s)) {
			const line = file.statementMap[key]?.start?.line;
			if (!Number.isSafeInteger(line) || line < 1) throw new TypeError(`${file.path} has an invalid statement line.`);
			lines.set(line, (lines.get(line) ?? false) || count > 0);
			totals.statements.total += 1;
			if (count > 0) totals.statements.covered += 1;
		}
		for (const covered of lines.values()) {
			totals.lines.total += 1;
			if (covered) totals.lines.covered += 1;
		}
		for (const count of Object.values(file.f)) {
			totals.functions.total += 1;
			if (count > 0) totals.functions.covered += 1;
		}
		for (const counts of Object.values(file.b)) {
			for (const count of counts) {
				totals.branches.total += 1;
				if (count > 0) totals.branches.covered += 1;
			}
		}
	}
	return Object.fromEntries(Object.entries(totals).map(([metric, counts]) => [metric, {
		...counts,
		percentage: counts.total === 0 ? 100 : 100 * counts.covered / counts.total,
	}]));
}

function assertObject(value, label) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
}

