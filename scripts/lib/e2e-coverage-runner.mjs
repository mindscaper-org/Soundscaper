/* SPDX-License-Identifier: AGPL-3.0-only */

import { diagnosticErrorMessage as errorMessage } from './diagnostic-error-message.ts';

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	E2E_COVERAGE_CONFIGURATION,
	E2E_REPOSITORY_URL_PREFIX,
	analyzeE2ECoverage,
	formatE2ECoverageResult,
	parseE2EInventory,
	parseE2ESurfaceManifest,
	validateE2EExecutableObservation,
	validateE2EInventoryFiles,
} from './e2e-coverage-contract.mjs';
import { validateCoverageFileRecords } from './e2e-coverage-integrity.mjs';
import { validateE2ERawV8TopologyGroups } from './e2e-v8-topology.mjs';
import { createRawV8SurfaceValidation } from './e2e-v8-profile-observations.ts';
import { withV8MaterializationSpool } from './e2e-v8-materialization-spool.ts';

export function runE2ECoverageGate({
	repositoryRoot,
	artifactRoot,
	reportRoot,
	configuration = E2E_COVERAGE_CONFIGURATION,
	expectedRevision = repositoryRevision(repositoryRoot),
}) {
	const inventory = parseE2EInventory(readJson(join(artifactRoot, 'inventory.json')), configuration);
	const surfaceManifests = {};
	const coverageBySurface = {};
	const evidenceFailures = validateE2EInventoryFiles(inventory, repositoryRoot, artifactRoot);
	const observedCoverageUrls = [];
	const v8SurfacesToMaterialize = [];
	let coverageUnion;
	for (const { id } of configuration.requiredSurfaces) {
		const surfaceDirectory = join(artifactRoot, 'surfaces', id);
		const manifestPath = join(surfaceDirectory, 'manifest.json');
		if (!existsSync(manifestPath)) continue;
		const manifestValue = readJson(manifestPath);
		surfaceManifests[id] = manifestValue;
		let manifest;
		try {
			manifest = parseE2ESurfaceManifest(manifestValue, inventory, configuration);
		} catch {
			continue;
		}
		try {
			if (manifest.coverage.format === 'istanbul') {
				coverageBySurface[id] = normalizeCoveragePaths(
					readJson(resolveInside(surfaceDirectory, manifest.coverage.path)),
					inventory,
					repositoryRoot,
					artifactRoot,
				);
			} else {
				coverageBySurface[id] = {};
				v8SurfacesToMaterialize.push({ manifest, surfaceDirectory });
			}
		} catch (error) {
			evidenceFailures.push(`${id} coverage could not be materialized: ${errorMessage(error)}`);
		}
	}
	if (v8SurfacesToMaterialize.length > 0) {
		try {
			const materialized = materializeV8CoverageUnion({
				repositoryRoot,
				artifactRoot,
				reportDirectory: join(reportRoot, 'v8-union'),
				surfaces: v8SurfacesToMaterialize,
				inventory,
			});
			evidenceFailures.push(...materialized.failures);
			observedCoverageUrls.push(...materialized.observedCoverageUrls);
			coverageUnion = materialized.coverage;
		} catch (error) {
			evidenceFailures.push(`V8 coverage union could not be materialized: ${errorMessage(error)}`);
		}
	}
	const v8Surfaces = new Set(configuration.requiredSurfaces
		.filter(({ coverageFormat }) => coverageFormat === 'v8')
		.map(({ id }) => id));
	evidenceFailures.push(...validateE2EExecutableObservation(
		observedCoverageUrls,
		inventory.scripts.filter(({ surface }) => v8Surfaces.has(surface)),
	));
	const analysis = analyzeE2ECoverage({
		configuration,
		inventory,
		surfaceManifests,
		coverageBySurface,
		coverageUnion,
		expectedRevision,
	});
	analysis.failures.unshift(...evidenceFailures);
	process.stdout.write(formatE2ECoverageResult(analysis));
	if (analysis.failures.length > 0) process.stderr.write(`${analysis.failures.join('\n')}\n`);
	return analysis;
}

export function materializeV8SurfaceCoverage({
	repositoryRoot,
	artifactRoot,
	surfaceDirectory,
	reportDirectory,
	manifest,
	inventory,
}) {
	return materializeV8CoverageUnion({
		repositoryRoot,
		artifactRoot,
		reportDirectory,
		surfaces: [{ surfaceDirectory, manifest }],
		inventory,
	});
}

export function materializeV8CoverageUnion({
	repositoryRoot,
	artifactRoot,
	reportDirectory,
	surfaces,
	inventory,
}) {
	if (!Array.isArray(surfaces) || surfaces.length === 0) {
		throw new TypeError('The raw V8 union needs at least one coverage surface.');
	}
	const failures = [];
	const observedCoverageUrls = [];
	const rebasedDirectory = join(reportDirectory, 'v8-rebased');
	const hasProfiles = withV8MaterializationSpool(reportDirectory, inventory.scripts, (spool) => {
		for (const { surfaceDirectory, manifest } of surfaces) {
			const rawDirectory = resolveInside(surfaceDirectory, manifest.coverage.path);
			const fileFailures = validateCoverageFileRecords(rawDirectory, manifest.coverage.files, manifest.surface);
			if (fileFailures.length > 0) throw new Error(fileFailures.join('\n'));
			const validation = createRawV8SurfaceValidation(manifest.surface, inventory.scripts);
			const staged = spool.beginSurface(manifest.surface, (profile) => (
				rebasePortableV8Profile(profile, inventory, repositoryRoot, artifactRoot)
			));
			for (const { name, profile } of readV8Profiles(rawDirectory, manifest.coverage.files, manifest.surface)) {
				observedCoverageUrls.push(...(Array.isArray(profile.result)
					? profile.result.map(({ url }) => url).filter((url) => typeof url === 'string') : []));
				validation.observe(profile);
				staged.write(name, profile);
			}
			const surfaceFailures = validation.finish();
			failures.push(...surfaceFailures);
			if (surfaceFailures.length === 0) staged.accept();
		}
		if (spool.count === 0) return false;
		failures.push(...validateE2ERawV8TopologyGroups({ artifactRoot, scripts: inventory.scripts,
			observationsForGroup: spool.observationsForGroup }));
		spool.publish(rebasedDirectory);
		return true;
	});
	if (!hasProfiles) return { coverage: {}, failures, observedCoverageUrls };
	const istanbulDirectory = join(reportDirectory, 'istanbul');
	rmSync(istanbulDirectory, { recursive: true, force: true });
	mkdirSync(istanbulDirectory, { recursive: true });
	const c8Configuration = join(reportDirectory, 'c8.json');
	writeFileSync(c8Configuration, JSON.stringify({
		all: false,
		exclude: ['**/node_modules/**', '**/vendor/**'],
		extension: ['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts', '.jsx', '.tsx'],
		include: ['**/*'],
	}));
	const outcome = spawnSync(resolve(repositoryRoot, 'node_modules/.bin/c8'), [
		'report',
		`--config=${c8Configuration}`,
		`--temp-directory=${rebasedDirectory}`,
		`--reports-dir=${istanbulDirectory}`,
		'--reporter=json',
		'--allowExternal',
		'--exclude-after-remap',
	], { cwd: repositoryRoot, env: process.env, encoding: 'utf8' });
	if (outcome.error) throw outcome.error;
	if (outcome.signal) throw new Error(`c8 terminated with ${outcome.signal}.`);
	if (outcome.status !== 0) {
		throw new Error(`c8 exited with status ${outcome.status ?? 1}: ${outcome.stderr.trim()}`);
	}
	const coverage = normalizeCoveragePaths(
		readJson(join(istanbulDirectory, 'coverage-final.json')),
		inventory,
		repositoryRoot,
		artifactRoot,
	);
	return { coverage, failures, observedCoverageUrls };
}

export function rebasePortableV8Profile(profile, inventory, repositoryRoot, artifactRoot) {
	const urlMap = new Map(inventory.scripts.map((script) => [
		script.coverageUrl,
		pathToFileURL(resolveInside(artifactRoot, script.artifactPath)).href,
	]));
	const rebased = structuredClone(profile);
	for (const entry of rebased.result ?? []) entry.url = urlMap.get(entry.url) ?? entry.url;
	const sourceMapCache = {};
	for (const [url, cached] of Object.entries(rebased['source-map-cache'] ?? {})) {
		const entry = structuredClone(cached);
		if (entry?.data && Array.isArray(entry.data.sources)) {
			entry.data.sources = entry.data.sources.map((source) => rebaseSourceUrl(
				source,
				urlMap,
				repositoryRoot,
			));
		}
		sourceMapCache[urlMap.get(url) ?? url] = entry;
	}
	rebased['source-map-cache'] = sourceMapCache;
	return rebased;
}

export function normalizeCoveragePaths(coverage, inventory, repositoryRoot, artifactRoot) {
	const aliases = new Map();
	for (const source of inventory.sources) {
		const actual = source.origin === 'repository'
			? resolveInside(repositoryRoot, source.path)
			: resolveInside(artifactRoot, source.artifactPath);
		aliases.set(actual, source.path);
		aliases.set(pathToFileURL(actual).href, source.path);
		aliases.set(source.path, source.path);
	}
	const normalized = {};
	for (const [reportedPath, fileCoverage] of Object.entries(coverage)) {
		const candidate = typeof fileCoverage?.path === 'string' ? fileCoverage.path : reportedPath;
		const path = aliases.get(candidate) ?? aliases.get(asAbsolutePath(candidate)) ?? portableSourcePath(candidate)
			?? normalizeUnknownPath(candidate, repositoryRoot);
		if (path in normalized) throw new Error(`Coverage reports executable source ${path} twice.`);
		normalized[path] = { ...fileCoverage, path };
	}
	return normalized;
}

function* readV8Profiles(directory, records, surface) {
	if (!existsSync(directory)) return;
	const expected = new Map(records.map(record => [record.path, record]));
	const names = readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.sort((left, right) => left.name.localeCompare(right.name));
	for (const { name } of names) {
		const bytes = readFileSync(join(directory, name));
		const record = expected.get(name);
		if (!record || record.byteLength !== bytes.byteLength
			|| record.sha256 !== `sha256:${createHash('sha256').update(bytes).digest('hex')}`) {
			throw new Error(`${surface} coverage-file inventory or bytes do not match its manifest.`);
		}
		yield { name, profile: JSON.parse(bytes.toString('utf8')) };
	}
}

function rebaseSourceUrl(source, urlMap, repositoryRoot) {
	if (typeof source !== 'string') return source;
	if (urlMap.has(source)) return urlMap.get(source);
	if (!source.startsWith(E2E_REPOSITORY_URL_PREFIX)) return source;
	const relativePath = decodeURIComponent(source.slice(E2E_REPOSITORY_URL_PREFIX.length));
	return pathToFileURL(resolveInside(repositoryRoot, relativePath)).href;
}

function portableSourcePath(path) {
	if (typeof path !== 'string' || !path.startsWith(E2E_REPOSITORY_URL_PREFIX)) return null;
	return decodeURIComponent(path.slice(E2E_REPOSITORY_URL_PREFIX.length));
}

function asAbsolutePath(path) {
	if (typeof path !== 'string') return '';
	if (path.startsWith('file:')) {
		try {
			return fileURLToPath(path);
		} catch {
			return '';
		}
	}
	return isAbsolute(path) ? path : '';
}

function normalizeUnknownPath(path, repositoryRoot) {
	const absolute = asAbsolutePath(path);
	if (absolute === '') return String(path).replaceAll('\\', '/').replace(/^\.\//u, '');
	const candidate = relative(resolve(repositoryRoot), absolute);
	return candidate.split(sep).join('/');
}

function repositoryRevision(repositoryRoot) {
	const outcome = spawnSync('git', ['rev-parse', 'HEAD'], {
		cwd: repositoryRoot,
		encoding: 'utf8',
	});
	if (outcome.error) throw outcome.error;
	if (outcome.status !== 0) throw new Error(`Could not read the checked-out revision: ${outcome.stderr.trim()}`);
	return outcome.stdout.trim();
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function resolveInside(root, path) {
	const absoluteRoot = resolve(root);
	const resolved = resolve(absoluteRoot, path);
	const child = relative(absoluteRoot, resolved);
	if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
		throw new Error(`Path ${path} escapes ${absoluteRoot}.`);
	}
	return resolved;
}
