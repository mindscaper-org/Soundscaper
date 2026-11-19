#!/usr/bin/env node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { partitionNodeTestBootstrapBatches } from './lib/node-test-bootstrap.mjs';

import {
	describeNodeTestSelection,
	NODE_TEST_SHARD_IDS,
	parseNodeTestSelection,
	partitionNodeTestExecutionBatches,
	selectNodeTestFiles,
} from './lib/node-test-shards.mjs';
import {
	assertRequiredLinuxNativeTestHost,
	REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV,
	requiredLinuxNativeSkipError,
} from './lib/required-linux-native-tests.mjs';
import {
	DESKTOP_RUNTIME_TEST_FIXTURE_ENV,
	needsDesktopRuntimeTestFixture,
} from './lib/node-test-desktop-runtime-fixture.ts';
import { OPENFX_TEST_FIXTURE_ENV, openFxTestFixtureArtifacts } from './lib/node-test-openfx-fixture.ts';
import { NATIVE_TEST_FIXTURE_ENV } from './lib/node-native-test-fixtures.ts';
import { selectedNativeTestFixtures } from './lib/node-native-test-fixture-recipes.ts';
import { DesktopRuntimeFixtureCompatibilityError, validateDesktopRuntimeTestArtifact } from './lib/node-test-desktop-runtime-artifact.ts';
import { COVERAGE_TEST_LAYERS } from './lib/e2e-coverage-layer-policy.mjs';
import {
	prepareQualifiedNodeArtifacts,
	QUALIFIED_NODE_MANIFEST_ENV,
	QUALIFIED_NODE_OUTPUT_ENV,
	QUALIFIED_NODE_TESTS_ENV,
} from './lib/qualified-node-artifacts.ts';

const root = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const coverageArgument = argv.find((argument) => argument.startsWith('--coverage-directory='));
const desktopFixtureArgument = argv.find(argument => argument.startsWith('--desktop-runtime-fixture='));
const requireLinuxNative = argv.includes('--require-linux-native');
let selectionArguments = argv.filter((argument) => (
	argument !== coverageArgument && argument !== desktopFixtureArgument && argument !== '--require-linux-native'
));
let moduleSelection = null;
if (selectionArguments.some(argument => /^--(?:module(?:-shard)?|suite|list|json)(?:=|$)/u.test(argument))) {
	const { parseModuleNodeSelection, selectModuleNodeFiles } = await import('./lib/module-test-selection.ts');
	const options = parseModuleNodeSelection(selectionArguments, NODE_TEST_SHARD_IDS);
	moduleSelection = { options, ...selectModuleNodeFiles(root, options, NODE_TEST_SHARD_IDS) };
	selectionArguments = [...options.remaining];
}
const selection = parseNodeTestSelection(selectionArguments);
let testFiles = selectNodeTestFiles(root, selection);
if (moduleSelection) {
	const selected = new Set(moduleSelection.files);
	testFiles = testFiles.filter(file => selected.has(file));
}
let modulePlan = null;
if (process.env.SCAPE_MODULE_PLAN) {
	const { readModuleExecutionPlan } = await import('./lib/check-module-repository.ts');
	modulePlan = readModuleExecutionPlan(root, process.env.SCAPE_MODULE_PLAN);
	const selected = new Set(modulePlan.nodeTests);
	testFiles = testFiles.filter(file => selected.has(file.slice(root.length + 1).replaceAll('\\', '/')));
}

if (moduleSelection?.options.list) {
	const selected = new Set(testFiles.map(file => file.slice(root.length + 1).replaceAll('\\', '/')));
	const suites = moduleSelection.suites.map(suite => ({ ...suite, files: suite.files.filter(file => selected.has(file)) }))
		.filter(suite => suite.files.length);
	console.log(moduleSelection.options.json ? JSON.stringify({ suites, testFiles }, null, 2)
		: suites.map(suite => `${suite.id}: ${suite.files.length} Node files, ${suite.fixtures.length} fixtures`).join('\n'));
	process.exit(0);
}
if (moduleSelection) console.log(`Module suites: ${moduleSelection.suites.map(suite => suite.id).join(', ')}.`);
if (requireLinuxNative) assertRequiredLinuxNativeTestHost(process.platform, process.arch);

if (testFiles.length === 0) {
	if (modulePlan?.mode === 'focused' || moduleSelection?.options.shard) {
		if (coverageArgument !== undefined) {
			const coverageDirectory = resolve(root, coverageArgument.slice('--coverage-directory='.length));
			rmSync(coverageDirectory, { recursive: true, force: true });
			rmSync(`${coverageDirectory}-qualified`, { recursive: true, force: true });
			mkdirSync(coverageDirectory, { recursive: true });
			writeFileSync(join(coverageDirectory, 'empty-module-selection.json'), JSON.stringify({ result: [] }));
		}
		console.log(`The module plan selects no tests for ${describeNodeTestSelection(selection)}.`);
		process.exit(0);
	}
	throw new Error(`No Node test files were found for ${describeNodeTestSelection(selection)}.`);
}

const env = { ...process.env };
// A test may start a runner in a fixture checkout with a different inventory.
delete env.SCAPE_MODULE_PLAN;
delete env[QUALIFIED_NODE_MANIFEST_ENV];
delete env[QUALIFIED_NODE_OUTPUT_ENV];
delete env[QUALIFIED_NODE_TESTS_ENV];
const checkAllProgress = env.SCAPE_CHECK_ALL_PROGRESS === '1';
// A fixture may invoke its own runner in a temporary checkout.
delete env.SCAPE_CHECK_ALL_PROGRESS;
let requiredNativeReportDirectory = null;
let requiredNativeReportPath = null;
if (requireLinuxNative) {
	requiredNativeReportDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-required-native-tests-'));
	requiredNativeReportPath = join(requiredNativeReportDirectory, 'skips.txt');
	env[REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV] = requiredNativeReportPath;
}
const qualifiedTestFiles = new Set();
if (coverageArgument !== undefined) {
	// Raw V8 profiles are collected directly rather than through c8: a shard only
	// has to hand its range data to the job that checks the thresholds over the
	// union, and c8 would spend minutes building a report nobody reads.
	const coverageDirectory = resolve(root, coverageArgument.slice('--coverage-directory='.length));
	rmSync(coverageDirectory, { recursive: true, force: true });
	mkdirSync(coverageDirectory, { recursive: true });
	env.NODE_V8_COVERAGE = coverageDirectory;
	const qualifiedOutput = `${coverageDirectory}-qualified`;
	rmSync(qualifiedOutput, { recursive: true, force: true });
	const qualified = prepareQualifiedNodeArtifacts({
		repositoryRoot: root,
		policy: COVERAGE_TEST_LAYERS,
		selectedTestFiles: testFiles,
		outputRoot: qualifiedOutput,
		expectedRevision: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim(),
	});
	if (qualified !== null) {
		env[QUALIFIED_NODE_MANIFEST_ENV] = qualified.manifestPath;
		env[QUALIFIED_NODE_OUTPUT_ENV] = qualified.captureDirectory;
		for (const test of qualified.manifest.selectedTests) qualifiedTestFiles.add(resolve(root, test.path));
		env[QUALIFIED_NODE_TESTS_ENV] = JSON.stringify([...qualifiedTestFiles]);
	}
}

const styleAssetLoader = resolve(root, 'scripts/node-style-asset-loader.mjs');
const requiredNativeReporter = resolve(root, 'scripts/require-linux-native-tests-reporter.mjs');
const checkAllReporter = resolve(root, 'scripts/check-all-node-reporter.ts');
const desktopRuntimeFixtureScript = resolve(root, 'scripts/lib/node-test-desktop-runtime-fixture.ts');
const openFxFixtureScript = resolve(root, 'scripts/prepare-node-openfx-test-fixture.mjs');
const nativeFixtureScript = resolve(root, 'scripts/prepare-node-native-test-fixtures.mjs');
let desktopRuntimeFixtureDirectory = null;
let ownsDesktopRuntimeFixture = false;
let openFxFixtureDirectory = null;
let nativeFixtureDirectory = null;
// Only this invocation may supply a fixture; direct test runs compile normally.
delete env[DESKTOP_RUNTIME_TEST_FIXTURE_ENV];
delete env[OPENFX_TEST_FIXTURE_ENV];
delete env[NATIVE_TEST_FIXTURE_ENV];
let executionError = null;
let exitCode = 0;
try {
	// Plan one source snapshot for this invocation, including isolated execution groups.
	const nativeFiles = new Set(partitionNodeTestBootstrapBatches(root, testFiles)
		.filter(batch => !batch.useLoaders).flatMap(batch => batch.files));
	for (const { files: batch, useLoaders } of partitionNodeTestExecutionBatches(testFiles)
		.flatMap(files => [
			{ files: files.filter(file => nativeFiles.has(file)), useLoaders: false },
			{ files: files.filter(file => !nativeFiles.has(file)), useLoaders: true },
		].filter(batch => batch.files.length > 0))) {
		// Authenticate a workflow artifact before starting sibling preparations.
		if (desktopRuntimeFixtureDirectory === null && desktopFixtureArgument !== undefined && needsDesktopRuntimeTestFixture(batch)) {
			const fixtureRoot = resolve(root, desktopFixtureArgument.slice('--desktop-runtime-fixture='.length));
			try {
				validateDesktopRuntimeTestArtifact({ repositoryRoot: root, fixtureRoot });
				desktopRuntimeFixtureDirectory = fixtureRoot;
			} catch (error) {
				if (!(error instanceof DesktopRuntimeFixtureCompatibilityError)) throw error;
				console.warn(`${error.message} Compiling a fresh desktop test runtime on this runner.`);
			}
		}
		const preparations = [];
		if (nativeFixtureDirectory === null && selectedNativeTestFixtures(batch, env, true).length > 0) {
			nativeFixtureDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-node-native-'));
			preparations.push(prepareFixture('Native test fixtures', [nativeFixtureScript, root, nativeFixtureDirectory, ...batch]));
		}
		if (openFxFixtureDirectory === null && openFxTestFixtureArtifacts(batch).length > 0) {
			openFxFixtureDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-node-openfx-'));
			preparations.push(prepareFixture('OpenFX test fixture', [openFxFixtureScript, root, openFxFixtureDirectory, ...batch]));
		}
		if (desktopRuntimeFixtureDirectory === null && needsDesktopRuntimeTestFixture(batch)) {
			desktopRuntimeFixtureDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-node-desktop-runtime-'));
			ownsDesktopRuntimeFixture = true;
			preparations.push(prepareFixture('Desktop test runtime', [desktopRuntimeFixtureScript, root, desktopRuntimeFixtureDirectory]));
		}
		// Independent compilers overlap, then all close before consumers or cleanup.
		let preparationFailed = false;
		for (const preparation of await Promise.all(preparations)) {
			if (preparation.error || preparation.signal) {
				executionError = preparation.error ?? new Error(`${preparation.label} compilation terminated with ${preparation.signal}.`);
			}
			if (preparation.status !== 0) {
				preparationFailed = true;
				exitCode = preparation.status ?? 1;
			}
		}
		if (executionError !== null || preparationFailed) break;
		if (openFxFixtureDirectory !== null) env[OPENFX_TEST_FIXTURE_ENV] = openFxFixtureDirectory;
		if (desktopRuntimeFixtureDirectory !== null) env[DESKTOP_RUNTIME_TEST_FIXTURE_ENV] = desktopRuntimeFixtureDirectory;
		if (nativeFixtureDirectory !== null) env[NATIVE_TEST_FIXTURE_ENV] = nativeFixtureDirectory;
		const result = spawnSync(process.execPath, [
			...(useLoaders ? ['--import', 'tsx', '--import', styleAssetLoader] : []),
			...(batch.some(file => qualifiedTestFiles.has(file)) ? ['--import', resolve(root, 'scripts/qualified-node-dispatch.mjs')] : []),
			...(env.SCAPE_NODE_TEST_CONCURRENCY ? [`--test-concurrency=${env.SCAPE_NODE_TEST_CONCURRENCY}`] : []),
			...(checkAllProgress ? ['--test-concurrency=2', '--test-reporter', checkAllReporter]
				: requireLinuxNative ? ['--test-reporter', requiredNativeReporter] : []),
			'--test', ...batch,
		], {
			cwd: root,
			env,
			stdio: 'inherit',
		});
		if (result.error) {
			executionError = result.error;
			break;
		}
		if (result.signal) {
			executionError = new Error(`Node test runner terminated with ${result.signal}.`);
			break;
		}
		if (result.status !== 0) exitCode = result.status ?? 1;
	}
} finally {
	if (ownsDesktopRuntimeFixture && desktopRuntimeFixtureDirectory !== null) {
		rmSync(desktopRuntimeFixtureDirectory, { recursive: true, force: true });
	}
	if (openFxFixtureDirectory !== null) rmSync(openFxFixtureDirectory, { recursive: true, force: true });
	if (nativeFixtureDirectory !== null) rmSync(nativeFixtureDirectory, { recursive: true, force: true });
}

let requiredNativeReport = '';
if (requiredNativeReportPath !== null) {
	try {
		requiredNativeReport = readFileSync(requiredNativeReportPath, 'utf8');
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	} finally {
		rmSync(requiredNativeReportDirectory, { recursive: true, force: true });
	}
}

if (executionError !== null) throw executionError;
const requiredNativeError = requiredLinuxNativeSkipError(requiredNativeReport);
if (requiredNativeError !== null) throw requiredNativeError;
process.exitCode = exitCode;

// Resolve failures as results so a sibling compiler always finishes before cleanup.
function prepareFixture(label, arguments_) {
	return new Promise((resolvePreparation) => {
		let error = null;
		const child = spawn(process.execPath, arguments_, { cwd: root, env, stdio: 'inherit' });
		child.once('error', (failure) => { error = failure; });
		child.once('close', (status, signal) => resolvePreparation({ label, error, status, signal }));
	});
}
