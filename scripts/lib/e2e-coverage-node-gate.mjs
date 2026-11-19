/* SPDX-License-Identifier: AGPL-3.0-only */

import { diagnosticErrorMessage } from './diagnostic-error-message.ts';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveCoverageTestLayers, validateCoverageTestLayerFiles } from './e2e-coverage-layer-policy.mjs';
import { E2E_COVERAGE_METRICS, normalizedFileCoverage, summarizeCoverage } from './e2e-coverage-metrics.mjs';
import { readQualifiedNodeEvidence } from './e2e-coverage-node-contract.mjs';
import { sha256Digest } from './e2e-coverage-integrity.mjs';
import { deriveTopology } from './e2e-v8-source-topology.mjs';
import { validateE2ERawV8Topology } from './e2e-v8-topology.mjs';

/**
 * Node and native maps are never merged. Every reviewed module must independently reach 100%.
 * @param {{repositoryRoot:string, inventory:object, policy:unknown, evidenceRoots?:readonly string[], reportRoot:string, expectedRevision:string}} options
 */
export function validateQualifiedNodeEvidence({ repositoryRoot, inventory, policy, evidenceRoots = [], reportRoot, expectedRevision }) {
	const resolution = resolveCoverageTestLayers({ policy, inventory });
	const failures = [], qualifiedSources = new Set(), evidence = [];
	const result = { qualifiedSources, failures, evidence, metrics: summarizeCoverage([]), files: 0,
		sourceFunctions: { covered: 0, total: 0 } };
	if (resolution.nodeSources.length === 0) {
		if (evidenceRoots.length > 0) failures.push('Node evidence supplied without any reviewed Node source ownership.');
		return result;
	}
	if (evidenceRoots.length === 0) {
		failures.push('Reviewed Node sources require qualified Node evidence; native coverage cannot substitute.'); return result;
	}
	try { validateCoverageTestLayerFiles(policy, { repositoryRoot }); }
	catch (error) { failures.push(`Node reviewed source/test selectors: ${diagnosticErrorMessage(error)}`); return result; }
	for (const evidenceRoot of evidenceRoots) {
		try { evidence.push(readQualifiedNodeEvidence({ evidenceRoot, repositoryRoot, inventory, policy, expectedRevision })); }
		catch (error) { failures.push(`Node evidence ${evidenceRoot}: ${diagnosticErrorMessage(error)}`); }
	}
	if (failures.length > 0) return result;
	try {
		validateReportRoot(reportRoot, repositoryRoot, evidenceRoots);
		const analyzed = materializeQualifiedNodeCoverage({ repositoryRoot, reportRoot, evidence, nodeSources: resolution.nodeSources });
		failures.push(...analyzed.failures); result.metrics = analyzed.metrics; result.files = analyzed.files;
		result.sourceFunctions = analyzed.sourceFunctions;
		if (failures.length === 0) for (const source of resolution.nodeSources) qualifiedSources.add(source.path);
	} catch (error) { failures.push(`Qualified Node coverage: ${diagnosticErrorMessage(error)}`); }
	return result;
}

function validateReportRoot(reportRoot, repositoryRoot, evidenceRoots) {
	const report = physicalPath(reportRoot);
	assert.ok(!contains(report, physicalPath(repositoryRoot)), 'Node report directory must not enclose the repository');
	for (const root of evidenceRoots) {
		const evidence = physicalPath(root);
		assert.ok(!contains(report, evidence) && !contains(evidence, report), 'Node report directory must not overlap immutable evidence');
	}
	function contains(root, candidate) {
		const path = relative(root, candidate);
		return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
	}
	function physicalPath(path) {
		const absolute = resolve(path);
		return existsSync(absolute) ? realpathSync(absolute) : join(physicalPath(dirname(absolute)), basename(absolute));
	}
}

export function materializeQualifiedNodeCoverage({ repositoryRoot, reportRoot, evidence, nodeSources }) {
	const compiledRoot = join(reportRoot, 'compiled'), rawRoot = join(reportRoot, 'raw'), istanbulRoot = join(reportRoot, 'istanbul');
	rmSync(reportRoot, { recursive: true, force: true });
	for (const directory of [compiledRoot, rawRoot, istanbulRoot]) mkdirSync(directory, { recursive: true });
	const canonicalModules = evidence[0].modules, scripts = [], rebasedUrls = new Map();
	for (const prepared of canonicalModules) {
		const { module, analysisSource } = prepared;
		const name = `${sha256Digest(module.sourcePath).slice('sha256:'.length)}-${module.generatedSha256.slice('sha256:'.length)}.mjs`;
		const artifactPath = `compiled/${name}`, coverageUrl = pathToFileURL(join(compiledRoot, name)).href;
		writeFileSync(join(reportRoot, artifactPath), analysisSource);
		scripts.push({ id: module.sourcePath, sources: [module.sourcePath], artifactPath, coverageUrl,
			coverageKey: sha256Digest(`${module.sourcePath}\n${module.generatedSha256}`), sourceMapSha256: null });
		for (const capture of evidence) {
			const other = capture.modules.find(value => value.module.sourcePath === module.sourcePath);
			assert.equal(other?.code, prepared.code, 'Node captures have incompatible compiled geometry');
			rebasedUrls.set(other.module.sourceUrl, coverageUrl);
		}
	}
	const profiles = evidence.flatMap(capture => capture.profiles).map(profile => ({
		result: profile.result.map(entry => ({ ...entry, url: rebasedUrls.get(entry.url) })),
		// The authenticated inline map comment is now whitespace; c8 sees the FULL compiled artifact.
		'source-map-cache': {},
	}));
	const failures = validateE2ERawV8Topology({ artifactRoot: reportRoot, profiles, scripts });
	const sourceFunctions = { covered: 0, total: 0 };
	for (const script of scripts) {
		const prepared = canonicalModules.find(value => value.module.sourcePath === script.id);
		const topology = deriveTopology(prepared.analysisSource, script.artifactPath, { owns: () => true, ownsAny: (start, end) => start < end });
		const entries = profiles.flatMap(profile => profile.result.filter(entry => entry.url === script.coverageUrl));
		for (const shape of topology.functionTopology.functions) {
			// Equal-span identities need distinct positive observations in an actual profile;
			// a containing root or another identity cannot lend an invocation to a lazy function.
			const complete = entries.some(entry => entry.functions.filter(fn => (
				fn.ranges[0]?.startOffset === shape.start && fn.ranges[0]?.endOffset === shape.end && fn.ranges[0]?.count > 0
			)).length === shape.identities.length);
			const nonRoot = shape.identities.length - (shape.start === 0 && shape.end === prepared.analysisSource.length ? 1 : 0);
			sourceFunctions.total += nonRoot; if (complete) sourceFunctions.covered += nonRoot;
			if (!complete) {
				failures.push(`${script.id} source-derived ${shape.kind} function ${shape.start}-${shape.end} has no positive Node invocation for every identity.`);
			}
		}
		if (!profiles.some(profile => profile.result.some(entry => entry.url === script.coverageUrl))) {
			failures.push(`${script.id} has no actual qualified Node runtime entry; its denominator is not optional.`);
		}
	}
	for (const [index, profile] of profiles.entries()) writeFileSync(join(rawRoot, `coverage-${index}.json`), JSON.stringify(profile));
	const configuration = join(reportRoot, 'c8.json');
	writeFileSync(configuration, JSON.stringify({ all: false, include: ['**/*'], exclude: [], extension: ['.mjs'] }));
	const outcome = spawnSync(resolve(repositoryRoot, 'node_modules/.bin/c8'), ['report', `--config=${configuration}`,
		`--temp-directory=${rawRoot}`, `--reports-dir=${istanbulRoot}`, '--reporter=json', '--allowExternal'],
	{ cwd: repositoryRoot, env: process.env, encoding: 'utf8' });
	if (outcome.error) throw outcome.error;
	assert.equal(outcome.signal, null, `Node c8 signal: ${outcome.signal}`);
	assert.equal(outcome.status, 0, `Node c8 failed: ${outcome.stderr}`);
	const coverage = JSON.parse(readFileSync(join(istanbulRoot, 'coverage-final.json'), 'utf8'));
	const files = [];
	assert.equal(Object.keys(coverage).length, canonicalModules.length, 'Node coverage must report every full prepared artifact, with no unknown files');
	for (const source of nodeSources) {
		const prepared = canonicalModules.find(value => value.module.sourcePath === source.path);
		const script = scripts.find(value => value.id === source.path);
		const reported = coverage[join(reportRoot, script.artifactPath)];
		assert.ok(reported, `${source.path} is missing its full compiled artifact coverage`);
		const normalized = normalizedFileCoverage(source.path, reported).coverage; files.push(normalized);
		const metrics = summarizeCoverage([normalized]);
		const topology = deriveTopology(prepared.analysisSource, script.artifactPath, { owns: () => true, ownsAny: (start, end) => start < end });
		for (const metric of E2E_COVERAGE_METRICS) {
			const counts = metrics[metric];
			const syntacticallyEmpty = metric === 'functions' ? topology.functionTopology.functions.length === 1
				: metric === 'branches' && topology.owners.every(owner => owner.branches.length === 0);
			if ((counts.total === 0 && !syntacticallyEmpty) || counts.covered !== counts.total) {
				failures.push(`${source.path} Node ${metric} coverage is ${counts.percentage.toFixed(2)}% (${counts.covered}/${counts.total}); independent 100% required.`);
			}
		}
	}
	return { failures, metrics: summarizeCoverage(files), files: files.length, sourceFunctions };
}
