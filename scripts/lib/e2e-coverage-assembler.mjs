/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	cpSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { loadE2EBuildEvidence } from './e2e-coverage-build-evidence.mjs';
import { validateCaptureIndex } from './e2e-coverage-builder.mjs';
import {
	E2E_COVERAGE_CONFIGURATION,
	E2E_COVERAGE_SCHEMA_VERSION,
} from './e2e-coverage-contract.mjs';
import {
	coverageFileRecords,
	e2eExecutableCoverageKey,
	sha256Digest,
	stableSha256Digest,
	validateE2EExecutableObservation,
} from './e2e-coverage-integrity.mjs';
import { assembleE2ERawProfiles } from './e2e-coverage-profile-assembly.mjs';
import { withE2ECoverageProfileSpool } from './e2e-coverage-profile-spool.ts';

export function assembleE2ECoverageCapture({
	repositoryRoot,
	runRoot,
	runRoots,
	outputRoot,
	expectedRevision = repositoryRevision(repositoryRoot),
	configuration = E2E_COVERAGE_CONFIGURATION,
}) {
	const roots = normalizedRunRoots(runRoot, runRoots);
	const destination = resolve(outputRoot ?? join(roots[0], 'coverage/e2e-capture'));
	assertOutputRoot(roots, resolve(repositoryRoot), destination);
	return withE2ECoverageProfileSpool(destination, (spool) => {
		let first;
		const buildEvidence = [];
		const targetDigests = new Map();
		const dynamicScripts = new Map();
		for (const [index, root] of roots.entries()) {
			const capture = loadRunCapture({
				expectedRevision, repositoryRoot: resolve(repositoryRoot), runRoot: root,
			});
			first ??= capture;
			assertCompatibleCapture(first, capture, targetDigests);
			buildEvidence.push(buildEvidenceRecord(capture, index));
			const assembled = assembleE2ERawProfiles({
				evidence: capture.evidence,
				repositoryRoot: resolve(repositoryRoot),
				runRoot: root,
				runtime: capture.runtime,
				createGroup: () => spool.group(`${String(index + 1).padStart(3, '0')}-`),
			});
			mergeDynamicScripts(dynamicScripts, assembled.dynamicScripts);
		}
		if (dynamicScripts.size === 0) {
			throw new Error('E2E coverage observed no authenticated macro dynamic module.');
		}
		assertRequiredSurfaceProfiles(spool, configuration);
		const captureIndex = createCaptureIndex({
			buildEvidence,
			configuration,
			dynamicScripts: [...dynamicScripts.values()].sort((left, right) => (
				left.coverageUrl.localeCompare(right.coverageUrl)
			)),
			evidence: first.evidence,
			outputRoot: spool.directory,
			sourceRevision: first.sourceRevision,
		});
		validateCaptureIndex(captureIndex, configuration);
		const observationFailures = validateE2EExecutableObservation(
			[...spool.observedUrls],
			captureIndex.scripts,
		);
		if (observationFailures.length > 0) throw new Error(observationFailures.join('\n'));
		writeJson(join(spool.directory, 'capture-index.json'), captureIndex);
		return Object.freeze({ captureIndex, outputRoot: destination });
	});
}

function loadRunCapture({ expectedRevision, repositoryRoot, runRoot }) {
	const envelope = readJson(join(runRoot, 'run.json'), `nightly run envelope at ${runRoot}`);
	if (!record(envelope) || envelope.schemaVersion !== 2
		|| envelope.kind !== 'soundscaper-desktop-nightly-tests'
		|| !/^[0-9a-f]{40}$/u.test(envelope.sourceRevision ?? '')
		|| !record(envelope.runtime)
		|| !['linux', 'win32', 'darwin'].includes(envelope.runtime.platform)
		|| !['x64', 'arm64'].includes(envelope.runtime.arch)) {
		throw new Error(`Nightly run ${runRoot} has no valid source revision and runtime envelope.`);
	}
	if (envelope.status !== 'passed' || typeof envelope.finishedAt !== 'string') {
		throw new Error(`Nightly run ${runRoot} did not finish successfully.`);
	}
	if (envelope.sourceRevision !== expectedRevision) {
		throw new Error(
			`Nightly run revision ${envelope.sourceRevision} does not match ${expectedRevision}.`,
		);
	}
	const evidence = loadE2EBuildEvidence({
		evidenceRoot: join(runRoot, 'coverage/build-evidence'),
		repositoryRoot,
		sourceRevision: envelope.sourceRevision,
	});
	return Object.freeze({
		evidence,
		runRoot,
		runtime: Object.freeze({ ...envelope.runtime }),
		sourceRevision: envelope.sourceRevision,
	});
}

function createCaptureIndex({
	buildEvidence,
	configuration,
	dynamicScripts,
	evidence,
	outputRoot,
	sourceRevision,
}) {
	const descriptors = evidenceScripts(evidence, dynamicScripts);
	const generated = generatedArtifacts(descriptors);
	const sources = new Map();
	const scripts = descriptors.map((descriptor) => {
		const surface = surfaceForScript(descriptor);
		let artifactPath;
		let ownedSources;
		if (descriptor.repositorySources.length > 0) {
			artifactPath = `executables/${surface}/${descriptor.artifactPath}`;
			materializeExecutable(descriptor, join(outputRoot, artifactPath));
			ownedSources = [...descriptor.repositorySources];
			for (const path of ownedSources) addRepositorySource(sources, path, surface);
		} else {
			const artifact = generated.get(generatedKey(descriptor));
			artifactPath = artifact.artifactPath;
			ownedSources = [artifact.sourcePath];
			addArtifactSource(sources, artifact, surface);
			if (!artifact.copied) {
				copyFile(descriptor.inputFile, join(outputRoot, artifactPath));
				artifact.copied = true;
			}
		}
		const sourceMapSha256 = descriptor.fullSourceMap === null
			? null : stableSha256Digest(descriptor.fullSourceMap);
		const executableSha256 = sha256Digest(descriptor.source);
		return {
			id: `${surface}/${descriptor.artifactPath}`,
			surface,
			inputPath: artifactPath,
			artifactPath,
			coverageUrl: descriptor.coverageUrl,
			sources: ownedSources.sort(),
			sourceMapSha256,
			coverageKey: e2eExecutableCoverageKey({
				sha256: executableSha256,
				sourceMapSha256,
				sources: ownedSources,
			}),
		};
	}).sort((left, right) => left.id.localeCompare(right.id));

	const surfaces = configuration.requiredSurfaces.map(({ id, coverageFormat }) => {
		const inputPath = `profiles/${id}`;
		const directory = join(outputRoot, inputPath);
		return {
			id,
			coverage: {
				format: coverageFormat,
				inputPath,
				path: 'v8',
				files: coverageFileRecords(directory),
			},
		};
	});
	return {
		schemaVersion: E2E_COVERAGE_SCHEMA_VERSION,
		kind: 'soundscaper-e2e-capture-index',
		sourceRevision,
		buildEvidence,
		sources: [...sources.values()]
			.map((source) => ({ ...source, surfaces: [...source.surfaces].sort() }))
			.sort((left, right) => left.path.localeCompare(right.path)),
		scripts,
		surfaces,
	};
}

function generatedArtifacts(descriptors) {
	const generated = new Map();
	for (const descriptor of descriptors.filter(({ repositorySources }) => repositorySources.length === 0)) {
		const key = generatedKey(descriptor);
		if (generated.has(key)) continue;
		const hash = sha256(descriptor.source);
		const extension = extname(descriptor.artifactPath).toLowerCase();
		generated.set(key, {
			artifactPath: `executables/generated/${hash}${extension}`,
			copied: false,
			sourcePath: `generated/${hash}${extension}`,
		});
	}
	return generated;
}

function generatedKey(descriptor) {
	return `${extname(descriptor.artifactPath).toLowerCase()}:${sha256(descriptor.source)}`;
}

function addRepositorySource(sources, path, surface) {
	const source = sources.get(path) ?? { path, origin: 'repository', surfaces: new Set() };
	source.surfaces.add(surface);
	sources.set(path, source);
}

function addArtifactSource(sources, artifact, surface) {
	const source = sources.get(artifact.sourcePath) ?? {
		path: artifact.sourcePath,
		origin: 'artifact',
		inputPath: artifact.artifactPath,
		artifactPath: artifact.artifactPath,
		surfaces: new Set(),
	};
	source.surfaces.add(surface);
	sources.set(source.path, source);
}

function evidenceScripts(evidence, dynamicScripts = []) {
	return [
		...[...evidence.browser.values()].flatMap(({ electronScripts, scripts }) => [
			...scripts,
			...electronScripts,
		]),
		...[...evidence.electron.values()].flatMap(({ scripts }) => scripts),
		...dynamicScripts,
	]
		.filter(({ owned }) => owned)
		.sort((left, right) => (
			`${surfaceForScript(left)}/${left.artifactPath}`
				.localeCompare(`${surfaceForScript(right)}/${right.artifactPath}`)
		));
}

function materializeExecutable(descriptor, destination) {
	if (descriptor.inputFile === null) {
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, descriptor.source);
		return;
	}
	copyFile(descriptor.inputFile, destination);
}

function surfaceForScript(script) {
	return script.runtime === 'browser'
		? `browser-chromium-${script.productId}-renderer`
		: `nightly-electron-${script.productId}-${script.realm}`;
}


function mergeDynamicScripts(merged, scripts) {
	for (const script of scripts) {
		const previous = merged.get(script.coverageUrl);
		if (previous !== undefined
			&& stableSha256Digest(previous) !== stableSha256Digest(script)) {
			throw new Error(`Nightly runs disagree about macro dynamic script ${script.coverageUrl}.`);
		}
		merged.set(script.coverageUrl, script);
	}
}

function assertRequiredSurfaceProfiles(profiles, configuration) {
	for (const { id } of configuration.requiredSurfaces) {
		if (profiles.count(id) === 0 || !profiles.hasEntries(id)) {
			throw new Error(`Required E2E surface ${id} supplied no executable coverage profile.`);
		}
	}
}

function assertCompatibleCapture(first, capture, targetDigests) {
	if (capture.sourceRevision !== first.sourceRevision) {
		throw new Error('Nightly run roots name different source revisions.');
	}
	if (capture.evidence.executableDigest !== first.evidence.executableDigest) {
		throw new Error('Nightly run roots contain different executable build-evidence hashes.');
	}
	const target = `${capture.runtime.platform}-${capture.runtime.arch}`;
	const previous = targetDigests.get(target);
	if (previous !== undefined && previous !== capture.evidence.digest) {
		throw new Error(`Nightly ${target} runs contain different full build-evidence hashes.`);
	}
	targetDigests.set(target, capture.evidence.digest);
}

function buildEvidenceRecord(capture, index) {
	return {
		id: `run-${String(index + 1).padStart(3, '0')}`,
		sourceRevision: capture.sourceRevision,
		runtime: { ...capture.runtime },
		digest: capture.evidence.digest,
		documents: Object.fromEntries(
			[...capture.evidence.electron.entries()].map(([productId, evidence]) => [
				productId,
				evidence.documents.map((document) => ({ ...document })),
			]),
		),
		executableDigest: capture.evidence.executableDigest,
		executableResources: Object.fromEntries(
			[...capture.evidence.electron.entries()].map(([productId, evidence]) => [
				productId,
				{ ...evidence.executableResources },
			]),
		),
		excludedRuntimeScripts: Object.fromEntries(
			[...capture.evidence.electron.entries()].map(([productId, evidence]) => [
				productId,
				evidence.excludedRuntimeScripts.map((script) => ({ ...script })),
			]),
		),
		webAssemblyResources: Object.fromEntries(
			[...capture.evidence.electron.entries()].map(([productId, evidence]) => [
				productId,
				evidence.webAssemblyResources.map((resource) => ({ ...resource })),
			]),
		),
		packageArchives: Object.fromEntries(
			[...capture.evidence.electron.entries()].map(([productId, evidence]) => [
				productId,
				{ ...evidence.packageArchive },
			]),
		),
	};
}

function normalizedRunRoots(runRoot, runRoots) {
	if (runRoot !== undefined && runRoots !== undefined) {
		throw new TypeError('Use either runRoot or runRoots, not both.');
	}
	const supplied = runRoots ?? (runRoot === undefined ? [] : [runRoot]);
	if (!Array.isArray(supplied) || supplied.length === 0
		|| supplied.some((root) => typeof root !== 'string' || !isAbsolute(root))) {
		throw new TypeError('E2E assembly needs one or more absolute nightly run roots.');
	}
	const roots = supplied.map((root) => resolve(root));
	if (new Set(roots).size !== roots.length) throw new Error('A nightly run root was supplied twice.');
	return roots;
}

function assertOutputRoot(runRoots, repositoryRoot, outputRoot) {
	if (!isAbsolute(outputRoot)) throw new TypeError('The E2E capture output root must be absolute.');
	const coverageRoots = [resolve(repositoryRoot, 'coverage'), ...runRoots.map((root) => resolve(root, 'coverage'))];
	const admitted = coverageRoots.some((coverageRoot) => {
		const child = relative(coverageRoot, outputRoot);
		return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
			&& !['build-evidence', 'v8-browser', 'v8-local-assistance', 'v8-packaged']
				.includes(child.split(sep)[0]);
	});
	if (!admitted) {
		throw new Error(
			'The E2E capture output must be a dedicated directory below the repository or a run coverage root.',
		);
	}
}

function copyFile(source, destination) {
	mkdirSync(dirname(destination), { recursive: true });
	cpSync(source, destination, { force: false, errorOnExist: true });
}

function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}

function readJson(path, label) {
	try { return JSON.parse(readFileSync(path, 'utf8')); }
	catch (error) { throw new Error(`The ${label} is not readable JSON.`, { cause: error }); }
}

function repositoryRevision(repositoryRoot) {
	const outcome = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' });
	if (outcome.error) throw outcome.error;
	if (outcome.status !== 0) throw new Error(`Could not read the checked-out revision: ${outcome.stderr.trim()}`);
	return outcome.stdout.trim();
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
