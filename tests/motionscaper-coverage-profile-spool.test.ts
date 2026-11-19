/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import fs, { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { assembleE2ECoverageCapture } from '../scripts/lib/e2e-coverage-assembler.mjs';
import { withE2ECoverageProfileSpool } from '../scripts/lib/e2e-coverage-profile-spool.ts';
import { cleanupE2ECoverageAssemblerFixtures, makeFixture } from './helpers/e2e-coverage-assembler-fixture.mjs';

const surface = 'browser-chromium-motionscaper-renderer';
const appUrl = 'file:///__soundscaper_e2e__/browser/motionscaper/assets/app.js';
const workerUrl = 'file:///__soundscaper_e2e__/browser/motionscaper/assets/preview-worker.js';
const appMap = { data: { version: 3, sources: ['file:///__soundscaper_repo__/src/motionscaper/editor-project.ts'],
	sourcesContent: ['export const motion = 1;\n'], names: [], mappings: 'AAAA' }, lineLengths: [24], url: null };
const workerMap = { ...appMap, lineLengths: [36] };

function profile(url: string, count: number) {
	return { result: [{ scriptId: '1', url, functions: [{ functionName: '', isBlockCoverage: true,
		ranges: [{ startOffset: 0, endOffset: 24, count }, { startOffset: 8, endOffset: 16, count: count - 1 }] }] }],
	'source-map-cache': {} };
}

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

test('production assembly writes each profile before the next classification read and completes a run before reading another', (context) => {
	const fixture = makeFixture();
	const second = join(fixture.workspace, 'second-run');
	cpSync(fixture.runRoot, second, { recursive: true });
	const laterBrowser = join(fixture.runRoot, 'coverage/v8-browser/zz-later.json');
	cpSync(join(fixture.runRoot, 'coverage/v8-browser/browser.json'), laterBrowser);
	let laterReads = 0;
	let profileBoundary = false;
	let runBoundary = false;
	const stagingRoot = () => join(dirname(fixture.outputRoot), readdirSync(dirname(fixture.outputRoot))
		.find(name => name.startsWith('e2e-capture.staging-')) ?? 'missing-staging');
	const firstBrowser = () => join(stagingRoot(), 'profiles/browser-chromium-framescaper-renderer',
		'001-browser-browser.json-browser-chromium-framescaper-renderer.json');
	context.mock.method(fs, 'readFileSync', new Proxy(fs.readFileSync, {
		apply(target, receiver, args: unknown[]) {
			if (args[0] === laterBrowser && ++laterReads === 2) {
				assert.ok(existsSync(firstBrowser()), 'the first classified profile must be spooled before the second is parsed');
				profileBoundary = true;
			}
			if (args[0] === join(second, 'run.json')) {
				assert.ok(existsSync(firstBrowser()), 'the first run must already be on disk');
				const main = join(stagingRoot(), 'profiles/nightly-electron-framescaper-main');
				assert.ok(readdirSync(main).some(name => name.startsWith('001-local-node-')),
					'local-assistance profiles also spool before the next run');
				runBoundary = true;
			}
			return Reflect.apply(target, receiver, args) as ReturnType<typeof fs.readFileSync>;
		},
	}));
	syncBuiltinESMExports();
	try {
		const { runRoot, ...options } = fixture;
		const result = assembleE2ECoverageCapture({ ...options, runRoot: undefined, runRoots: [runRoot, second] });
		assert.equal(profileBoundary, true);
		assert.equal(runBoundary, true);
		assert.equal(result.captureIndex.buildEvidence.length, 2);
	} finally {
		context.mock.restoreAll();
		syncBuiltinESMExports();
		cleanupE2ECoverageAssemblerFixtures();
	}
});

test('Motion profiles spool before the next input across runs, preserving exact ranges and family map placement', () => {
	const workspace = mkdtempSync(join(tmpdir(), 'motion-coverage-spool-'));
	const destination = join(workspace, 'capture');
	try {
		const expected = new Map<string, unknown>();
		const result = withE2ECoverageProfileSpool(destination, (spool) => {
			let previousPath: string | undefined;
			for (const run of [1, 2]) {
				// Loading a subsequent run must not defer the preceding run's writes.
				if (previousPath !== undefined) assert.ok(existsSync(previousPath));
				const prefix = `${String(run).padStart(3, '0')}-`;
				const browser = spool.group(prefix);
				for (const [index, url] of [appUrl, workerUrl].entries()) {
					// This is the next-profile read boundary, not a GC/RSS timing oracle.
					if (previousPath !== undefined) assert.ok(existsSync(previousPath));
					const name = `browser-${index}-${surface}.json`;
					const value = profile(url, run + index + 1);
					browser.write(surface, name, value);
					previousPath = join(spool.directory, 'profiles', surface, `${prefix}${name}`);
					assert.deepEqual(readJson(previousPath), value, 'normalized ranges are already on disk');
					expected.set(`${prefix}${name}`, index === 0
						? { ...value, 'source-map-cache': { [appUrl]: appMap, [workerUrl]: workerMap } }
						: value);
				}
				// A map observed after the first profile still belongs on that first file.
				browser.attachMaps(surface, { [appUrl]: appMap, [workerUrl]: workerMap });
				assert.equal(browser.count(surface), 2);
				const local = spool.group(prefix);
				const localName = `local-cdp-motion-${surface}.json`;
				const localProfile = profile(appUrl, run + 5);
				local.write(surface, localName, localProfile);
				local.attachMaps(surface, { [appUrl]: appMap });
				expected.set(`${prefix}${localName}`, { ...localProfile, 'source-map-cache': { [appUrl]: appMap } });
			}
			assert.equal(spool.count(surface), 6);
			assert.equal(spool.hasEntries(surface), true);
			assert.deepEqual([...spool.observedUrls], [appUrl, workerUrl]);
			return { profileCount: spool.count(surface) };
		});
		assert.deepEqual(result, { profileCount: 6 });
		const directory = join(destination, 'profiles', surface);
		assert.deepEqual(readdirSync(directory).sort(), [...expected.keys()].sort());
		for (const [name, value] of expected) {
			assert.equal(readFileSync(join(directory, name), 'utf8'), `${JSON.stringify(value, null, '\t')}\n`);
		}
		assert.deepEqual(readdirSync(destination), ['profiles']);
	} finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('production assembly rejects changed bytes between browser passes and preserves the previous capture', (context) => {
	const fixture = makeFixture();
	const rawPath = join(fixture.runRoot, 'coverage/v8-browser/browser.json');
	const original = readFileSync(rawPath, 'utf8');
	mkdirSync(fixture.outputRoot);
	writeFileSync(join(fixture.outputRoot, 'capture-index.json'), 'previous capture\n');
	let reads = 0;
	context.mock.method(fs, 'readFileSync', new Proxy(fs.readFileSync, {
		apply(target, receiver, args: unknown[]) {
			if (args[0] === rawPath && ++reads === 2) writeFileSync(rawPath, `${original}\n`);
			return Reflect.apply(target, receiver, args) as ReturnType<typeof fs.readFileSync>;
		},
	}));
	syncBuiltinESMExports();
	try {
		assert.throws(() => assembleE2ECoverageCapture({ ...fixture, runRoots: undefined }),
			/browser profile browser\.json changed between coverage passes/u);
		assert.equal(readFileSync(join(fixture.outputRoot, 'capture-index.json'), 'utf8'), 'previous capture\n');
		assert.deepEqual(readdirSync(fixture.outputRoot), ['capture-index.json']);
		assert.equal(readdirSync(dirname(fixture.outputRoot)).some(name => name.startsWith('e2e-capture.staging-')), false);
	} finally {
		context.mock.restoreAll();
		syncBuiltinESMExports();
		cleanupE2ECoverageAssemblerFixtures();
	}
});

test('Motion late source-map conflict retires staging and preserves the previous capture after early writes', () => {
	const workspace = mkdtempSync(join(tmpdir(), 'motion-coverage-spool-conflict-'));
	const destination = join(workspace, 'capture');
	mkdirSync(destination);
	writeFileSync(join(destination, 'capture-index.json'), 'previous authenticated capture\n');
	let wroteBeforeConflict = false;
	try {
		assert.throws(() => withE2ECoverageProfileSpool(destination, (spool) => {
			for (const run of [1, 2]) {
				const group = spool.group(`${String(run).padStart(3, '0')}-`);
				group.write(surface, `browser-${surface}.json`, profile(appUrl, run));
				group.storeSourceMap(appUrl, appMap, `conflicting Motion source map for ${appUrl}`);
				assert.deepEqual(group.readSourceMap(appUrl), appMap);
				if (run === 2) {
					wroteBeforeConflict = existsSync(join(spool.directory, 'profiles', surface, `001-browser-${surface}.json`));
					group.storeSourceMap(appUrl, { ...appMap, lineLengths: [999] }, `conflicting Motion source map for ${appUrl}`);
				}
			}
		}), /conflicting Motion source map/u);
		assert.equal(wroteBeforeConflict, true);
		assert.deepEqual(readdirSync(destination), ['capture-index.json']);
		assert.equal(readFileSync(join(destination, 'capture-index.json'), 'utf8'), 'previous authenticated capture\n');
		assert.deepEqual(readdirSync(workspace), ['capture'], 'all staged profiles and map caches retire on rejection');
	} finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('Motion duplicate normalized profile names reject without overwriting an earlier profile', () => {
	const workspace = mkdtempSync(join(tmpdir(), 'motion-coverage-spool-duplicate-'));
	const destination = join(workspace, 'capture');
	try {
		assert.throws(() => withE2ECoverageProfileSpool(destination, (spool) => {
			const first = spool.group('001-');
			first.write(surface, 'same.json', profile(appUrl, 1));
			spool.group('001-').write(surface, 'same.json', profile(workerUrl, 2));
		}), /Two raw E2E profiles resolve to 001-same\.json/u);
		assert.deepEqual(readdirSync(workspace), []);
	} finally { rmSync(workspace, { recursive: true, force: true }); }
});
