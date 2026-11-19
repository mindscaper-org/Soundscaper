/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { canonicalJson } from './canonical-json.mjs';
import { E2E_COVERAGE_CONFIGURATION } from './e2e-coverage-contract.mjs';

const METRICS = Object.freeze(['lines', 'statements', 'functions', 'branches']);
const CONFIGURED_SURFACES = new Set(E2E_COVERAGE_CONFIGURATION.requiredSurfaces.map(({ id }) => id));
const HASH = /^sha256:[a-f0-9]{64}$/u;

export const COVERAGE_TEST_LAYERS_URL = new URL('../../config/coverage-test-layers.json', import.meta.url);
export const COVERAGE_TEST_LAYERS = parseCoverageTestLayers(
	JSON.parse(readFileSync(COVERAGE_TEST_LAYERS_URL, 'utf8')),
);

/** Eligibility is reviewed source ownership, never a claim that a capture passed. */
export function parseCoverageTestLayers(value) {
	exactObject(value, ['schemaVersion', 'kind', 'defaultLayer', 'thresholds', 'sources'], 'Coverage test layers');
	if (value.schemaVersion !== 1 || value.kind !== 'soundscaper-coverage-test-layers') {
		throw new TypeError('Coverage test layers need the supported schema and kind.');
	}
	if (value.defaultLayer !== 'native') throw new TypeError('The default coverage layer must remain native.');
	exactObject(value.thresholds, METRICS, 'Coverage layer thresholds');
	for (const metric of METRICS) {
		if (value.thresholds[metric] !== 100) throw new RangeError(`Coverage layer ${metric} must be exactly 100%.`);
	}
	if (!Array.isArray(value.sources)) throw new TypeError('Coverage test layers must list exact source files.');
	const sources = Array.from(value.sources, sourcePolicy);
	sortedUnique(sources.map(({ path }) => path), 'Coverage layer source paths');
	return Object.freeze({
		schemaVersion: 1,
		kind: 'soundscaper-coverage-test-layers',
		defaultLayer: 'native',
		thresholds: Object.freeze(Object.fromEntries(METRICS.map(metric => [metric, 100]))),
		sources: Object.freeze(sources),
	});
}

export function digestCoverageTestLayers(policy) {
	return hash(canonicalJson(parseCoverageTestLayers(policy)));
}

/** Preserve the complete native inventory; select only which full denominator scores each source. */
export function resolveCoverageTestLayers({ policy, inventory }) {
	const parsed = parseCoverageTestLayers(policy);
	if (!inventory || !Array.isArray(inventory.sources) || !Array.isArray(inventory.scripts)) {
		throw new TypeError('Coverage layer resolution needs the authenticated executable inventory.');
	}
	const sourceByPath = new Map();
	for (const source of inventory.sources) {
		if (sourceByPath.has(source.path)) throw new Error(`The executable inventory duplicates ${source.path}.`);
		sourceByPath.set(source.path, source);
	}
	const entryByPath = new Map(parsed.sources.map(entry => [entry.path, entry]));
	for (const entry of parsed.sources) {
		const source = sourceByPath.get(entry.path);
		if (!source) throw new Error(`Node coverage source ${entry.path} is absent from the executable inventory.`);
		if (source.origin !== 'repository') throw new Error(`Node coverage source ${entry.path} is not a repository source.`);
		if (source.sha256 !== entry.sourceSha256) throw new Error(`Node coverage source ${entry.path} changed since its eligibility review.`);
		if (entry.nativeWitness.surfaces.some(surface => !source.surfaces.includes(surface))) {
			throw new Error(`Native witness for ${entry.path} names a surface that does not own the source.`);
		}
	}
	const sources = Object.freeze(inventory.sources.map(source => {
		const policyEntry = entryByPath.get(source.path);
		return Object.freeze({
			...source,
			layer: policyEntry ? 'node-deterministic' : 'native',
			...(policyEntry ? { policyEntry } : {}),
		});
	}));
	return Object.freeze({
		policyDigest: digestCoverageTestLayers(parsed),
		sources,
		nodeSources: Object.freeze(sources.filter(source => source.layer === 'node-deterministic')),
		nativeSources: Object.freeze(sources.filter(source => source.layer === 'native')),
		scripts: inventory.scripts,
	});
}

/** Check actual files separately: parsing a safe path is not filesystem evidence. */
export function validateCoverageTestLayerFiles(policy, { repositoryRoot }) {
	const parsed = parseCoverageTestLayers(policy);
	const root = realpathSync(repositoryRoot);
	for (const entry of parsed.sources) {
		const source = repositoryFile(root, entry.path);
		if (hash(readFileSync(source)) !== entry.sourceSha256) {
			throw new Error(`Reviewed Node source ${entry.path} does not match its source SHA-256.`);
		}
		for (const testPath of entry.nodeTests) repositoryFile(root, testPath);
		repositoryFile(root, entry.nativeWitness.spec);
	}
	return parsed;
}

function sourcePolicy(value) {
	exactObject(value, ['path', 'layer', 'sourceSha256', 'nodeTests', 'nativeWitness', 'reason'], 'Coverage source policy');
	if (!productionPath(value.path)) throw new TypeError('Node coverage requires an exact safe production source path, excluding generated and test sources.');
	if (value.layer !== 'node-deterministic') throw new TypeError('An explicit coverage layer must be node-deterministic.');
	if (typeof value.sourceSha256 !== 'string' || !HASH.test(value.sourceSha256)) {
		throw new TypeError(`Node coverage source ${value.path} needs its reviewed source SHA-256.`);
	}
	const nodeTests = nonemptyStrings(value.nodeTests, 'Node coverage test paths');
	if (nodeTests.some(path => !nodeTestPath(path))) throw new TypeError('Node coverage tests require exact Node test entrypoint paths.');
	sortedUnique(nodeTests, 'Node coverage test paths');
	exactObject(value.nativeWitness, ['spec', 'title', 'surfaces'], 'Native coverage witness');
	const witness = value.nativeWitness;
	if (!safePath(witness.spec) || !/^tests\/browser\/.+\.spec\.(?:[cm]?[jt]s|[jt]sx)$/u.test(witness.spec)) {
		throw new TypeError('A native coverage witness requires an exact browser spec path.');
	}
	if (!text(witness.title, 1) || !text(value.reason, 40)) {
		throw new TypeError('Coverage ownership needs an exact native test title and a substantive deterministic-source reason.');
	}
	const surfaces = nonemptyStrings(witness.surfaces, 'Native coverage witness surfaces');
	sortedUnique(surfaces, 'Native coverage witness surfaces');
	if (surfaces.some(surface => !CONFIGURED_SURFACES.has(surface))) throw new TypeError('A native coverage witness names an unknown runtime surface.');
	return Object.freeze({
		path: value.path,
		layer: 'node-deterministic',
		sourceSha256: value.sourceSha256,
		nodeTests: Object.freeze([...nodeTests]),
		nativeWitness: Object.freeze({ spec: witness.spec, title: witness.title, surfaces: Object.freeze([...surfaces]) }),
		reason: value.reason,
	});
}

function productionPath(path) {
	return safePath(path) && /^(?:src|desktop)\/.+\.(?:[cm]?[jt]s|[jt]sx)$/u.test(path)
		&& !/(?:^|\/)(?:generated|__generated__|test|tests|__tests__|fixtures|__fixtures__|vendor|third_party)(?:\/|$)/u.test(path)
		&& !/\.(?:test|spec|generated|gen|d)\.[^.]+$/u.test(path);
}

function nodeTestPath(path) {
	return safePath(path) && /^tests\/(?!browser\/|electron\/|helpers\/|fixtures\/).+\.test\.(?:[cm]?[jt]s|[jt]sx)$/u.test(path);
}

function safePath(path) {
	return typeof path === 'string' && /^[A-Za-z0-9_./-]+$/u.test(path)
		&& !isAbsolute(path) && !path.split('/').some(part => part === '' || part === '.' || part === '..');
}

function exactObject(value, keys, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain object.`);
	const actual = Reflect.ownKeys(value);
	if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) {
		throw new TypeError(`${label} has missing or unknown fields.`);
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label} fields must be enumerable data properties.`);
	}
}

function nonemptyStrings(value, label) {
	if (!Array.isArray(value) || value.length === 0 || Array.from(value).some(entry => !text(entry, 1))) {
		throw new TypeError(`${label} must be a nonempty string array.`);
	}
	return value;
}

function sortedUnique(values, label) {
	if (new Set(values).size !== values.length) throw new TypeError(`${label} must not contain duplicates.`);
	if (values.some((value, index) => index > 0 && values[index - 1] > value)) throw new TypeError(`${label} must be sorted by code unit.`);
}

function text(value, minimum) {
	return typeof value === 'string' && value.trim() === value && value.length >= minimum
		&& !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function repositoryFile(root, path) {
	const actual = realpathSync(resolve(root, path));
	const relativePath = relative(root, actual);
	if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith('../') || relativePath.startsWith('..\\')) {
		throw new Error(`Coverage policy file ${path} escapes the repository through a symlink.`);
	}
	if (!statSync(actual).isFile()) throw new TypeError(`Coverage policy path ${path} must name an existing file.`);
	return actual;
}

function hash(bytes) {
	return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
