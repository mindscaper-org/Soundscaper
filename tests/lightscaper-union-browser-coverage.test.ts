/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { type TestContext } from 'node:test';

import { reportCoverageSummary } from '../scripts/lib/coverage-gate-runner.mjs';
import { rebaseCoverageProfileSources } from '../scripts/lib/coverage-profile-source-rebasing.mjs';
import { analyzeCoverageSummary } from '../scripts/lib/coverage-gates.mjs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const BROWSER_PATH = 'src/lightscaper/browser-measured.mjs', NODE_PATH = 'src/lightscaper/node-measured.mjs';
const SOURCE = 'export function measured() { return 7; }\nmeasured();\n';
interface FunctionCoverage { functionName: string; isBlockCoverage: boolean; ranges: { startOffset: number; endOffset: number; count: number }[] }
interface SourceMap { version: number; sources: string[]; names: string[]; mappings: string; sourcesContent?: (string | null)[]; x_soundscaper_source_sha256?: (string | null)[] }
interface Profile { result: { scriptId: string; url: string; functions: FunctionCoverage[] }[]; 'source-map-cache': Record<string, { lineLengths: number[]; data: SourceMap; url: null }> }
interface Summary { [path: string]: { lines: { total: number; covered: number }; branches: { total: number; covered: number }; functions: { total: number; covered: number } } }

function fixture(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), 'lightscaper-union-browser-coverage-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const path of [BROWSER_PATH, NODE_PATH]) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), SOURCE); }
	symlinkSync(join(PROJECT_ROOT, 'node_modules'), join(root, 'node_modules'), 'junction');
	writeFileSync(join(root, '.c8rc.json'), JSON.stringify({ all: true, extension: ['.mjs'], include: ['src/**/*.mjs'], exclude: [] }));
	const recorded = join(root, 'recorded'); mkdirSync(recorded);
	return { root, recorded };
}
function functions(): FunctionCoverage[] {
	return [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: SOURCE.length, count: 1 }] },
		{ functionName: 'measured', isBlockCoverage: true, ranges: [{ startOffset: 7, endOffset: SOURCE.indexOf('\n'), count: 1 }] }];
}
function browserProfile(kind: 'fixture' | 'portable'): Profile {
	const url = kind === 'fixture' ? 'file:///__w/Soundscaper/Soundscaper/.wrangler/lightscaper-native-test-runtime/observed.js'
		: 'file:///__soundscaper_e2e__/browser/lightscaper/assets/observed.js';
	const source = kind === 'fixture' ? `file:///__w/Soundscaper/Soundscaper/${BROWSER_PATH}` : `file:///__soundscaper_repo__/${BROWSER_PATH}`;
	return { result: [{ scriptId: '7', url, functions: functions() }], 'source-map-cache': {
		[url]: { lineLengths: SOURCE.trimEnd().split('\n').map(line => line.length), url: null,
			data: { version: 3, sources: [source], names: [], mappings: 'AAAA;AACA',
				x_soundscaper_source_sha256: [createHash('sha256').update(SOURCE).digest('hex')],
				...(kind === 'portable' ? { sourcesContent: [SOURCE] } : {}) } },
	} };
}

for (const kind of ['fixture', 'portable'] as const) test(`Lightscaper union counts its ${kind} browser hit beside unchanged local Node coverage`, t => {
	const f = fixture(t), profile = browserProfile(kind), original = JSON.stringify(profile);
	const originalPath = join(f.recorded, 'browser-chromium-1.json'); writeFileSync(originalPath, original);
	const node: Profile = { result: [{ scriptId: '3', url: pathToFileURL(join(f.root, NODE_PATH)).href, functions: functions() }], 'source-map-cache': {} };
	const nodeBytes = JSON.stringify(node), nodePath = join(f.recorded, 'lightscaper.json');
	const originalNodePath = join(f.root, 'node-original.json'); writeFileSync(originalNodePath, nodeBytes);
	if (process.platform === 'win32') writeFileSync(nodePath, nodeBytes);
	else symlinkSync(originalNodePath, nodePath, 'file');

	const prepared = rebaseCoverageProfileSources(profile, f.root) as Profile;
	assert.deepEqual(prepared.result, profile.result, 'Every V8 count, range, function, script ID and URL survives unchanged.');
	assert.deepEqual(Object.keys(prepared['source-map-cache']), Object.keys(profile['source-map-cache']));
	const url = profile.result[0]!.url;
	assert.deepEqual(prepared['source-map-cache'][url]!.lineLengths, profile['source-map-cache'][url]!.lineLengths);
	assert.equal(prepared['source-map-cache'][url]!.data.mappings, profile['source-map-cache'][url]!.data.mappings);
	assert.deepEqual(prepared['source-map-cache'][url]!.data.sources, [join(f.root, BROWSER_PATH)]);
	assert.equal(JSON.stringify(profile), original, 'Rebasing must not mutate its recorded profile.');
	assert.deepEqual(rebaseCoverageProfileSources(node, f.root), node);

	// This is the real shared check/tighten report path and actual c8 converter.
	// No generated observer.js artifact exists anywhere in the fixture.
	const summary = reportCoverageSummary(f.root, f.recorded) as Summary;
	for (const path of [BROWSER_PATH, NODE_PATH]) {
		const measured = summary[join(f.root, path)]; assert.ok(measured);
		assert.ok(measured.functions.covered > 0, `${path} must retain its recorded fixture function hit.`);
		assert.ok(measured.branches.covered > 0, `${path} must retain its recorded fixture branch hits.`);
	}
	const analysis = analyzeCoverageSummary(summary, f.root);
	const lightscaper = analysis.scopes.find(scope => scope.id === 'lightscaper'); assert.ok(lightscaper);
	const { functions: measuredFunctions, branches } = lightscaper.metrics; assert.ok(measuredFunctions); assert.ok(branches);
	assert.equal(lightscaper.files, 2); assert.ok(measuredFunctions.covered >= 2);
	assert.ok(branches.covered >= 2);
	assert.equal(readFileSync(originalPath, 'utf8'), original); assert.equal(readFileSync(nodePath, 'utf8'), nodeBytes);
});

for (const defect of ['hash', 'embedded', 'missing'] as const) test(`Lightscaper union rejects ${defect} source proof before reporting relocated browser coverage`, t => {
	const f = fixture(t), profile = browserProfile(defect === 'embedded' ? 'portable' : 'fixture');
	const map = profile['source-map-cache'][profile.result[0]!.url]!.data;
	if (defect === 'hash') { map.sourcesContent = [SOURCE]; map.x_soundscaper_source_sha256 = ['0'.repeat(64)]; }
	else if (defect === 'embedded') map.sourcesContent = [SOURCE.replace('return 7', 'return 8')];
	else delete map.x_soundscaper_source_sha256;
	const original = JSON.stringify(profile);
	assert.throws(() => rebaseCoverageProfileSources(profile, f.root), /stale or unproved mapped source bytes/u);
	assert.equal(JSON.stringify(profile), original);
});

test('Lightscaper union keeps zero-hit multi-source production lines uncovered', t => {
	const f = fixture(t), profile = browserProfile('fixture');
	const map = profile['source-map-cache'][profile.result[0]!.url]!.data;
	map.sources = [pathToFileURL(join(f.root, BROWSER_PATH)).href, 'https://example.invalid/vendor.mjs'];
	map.sourcesContent = [SOURCE, SOURCE]; map.x_soundscaper_source_sha256!.push(null);
	for (const fn of profile.result[0]!.functions) for (const range of fn.ranges) range.count = 0;
	const original = JSON.stringify(profile), path = join(f.recorded, 'browser-chromium-1.json'); writeFileSync(path, original);
	const summary = reportCoverageSummary(f.root, f.recorded) as Summary;
	assert.equal(summary[join(f.root, BROWSER_PATH)]!.lines.covered, 0);
	assert.equal(summary[join(f.root, BROWSER_PATH)]!.lines.total, 2);
	assert.equal(readFileSync(path, 'utf8'), original); assert.equal(JSON.stringify(profile), original);
});

test('Lightscaper union preserves vendor map slots and nonproduction route ownership beside a browser hit', t => {
	const f = fixture(t), profile = browserProfile('fixture'), url = profile.result[0]!.url;
	const map = profile['source-map-cache'][url]!.data;
	const external = ['https://xmlchars.example/src/xml/1.0/ed5.ts',
		'file:///__w/Soundscaper/Soundscaper/src/xml/1.0/ed5.ts'];
	map.sources.push(...external); map.x_soundscaper_source_sha256!.push(null, null);
	const original = JSON.stringify(profile), originalPath = join(f.recorded, 'browser-chromium-1.json');
	writeFileSync(originalPath, original);
	const prepared = rebaseCoverageProfileSources(profile, f.root) as Profile;
	assert.deepEqual(prepared['source-map-cache'][url]!.data.sources.slice(1), external);
	assert.deepEqual(prepared.result, profile.result);
	// Actual functions routes can contain a nested desktop/ path. Their Node
	// source maps must not be mistaken for the separately gated root desktop/.
	const routePath = join(f.root, 'functions/download/desktop/index.ts');
	mkdirSync(dirname(routePath), { recursive: true }); writeFileSync(routePath, SOURCE);
	const routeUrl = pathToFileURL(routePath).href;
	const route: Profile = { result: [{ scriptId: '11', url: routeUrl, functions: functions() }], 'source-map-cache': {
		[routeUrl]: { lineLengths: SOURCE.trimEnd().split('\n').map(line => line.length), url: null,
			data: { version: 3, sources: [routeUrl], sourcesContent: [SOURCE], names: [], mappings: 'AAAA;AACA' } },
	} };
	assert.deepEqual(rebaseCoverageProfileSources(route, f.root), route);
	writeFileSync(join(f.recorded, 'common-2.json'), JSON.stringify(route));
	const nodeUrl = pathToFileURL(join(f.root, NODE_PATH)).href;
	const node: Profile = { result: [{ scriptId: '12', url: nodeUrl, functions: functions() }], 'source-map-cache': {
		[nodeUrl]: { lineLengths: SOURCE.trimEnd().split('\n').map(line => line.length), url: null,
			data: { version: 3, sources: [nodeUrl, routeUrl], sourcesContent: [SOURCE, SOURCE], names: [], mappings: 'AAAA;AACA' } },
	} };
	const nodeBytes = JSON.stringify(node), nodePath = join(f.recorded, 'lightscaper.json'); writeFileSync(nodePath, nodeBytes);
	const preparedNode = rebaseCoverageProfileSources(node, f.root) as Profile;
	assert.deepEqual(preparedNode.result, node.result);
	const summary = reportCoverageSummary(f.root, f.recorded) as Summary;
	assert.ok(summary[join(f.root, BROWSER_PATH)]!.functions.covered > 0);
	assert.ok(summary[join(f.root, NODE_PATH)]!.functions.covered > 0);
	assert.deepEqual(preparedNode['source-map-cache'][nodeUrl]!.data.sources, [join(f.root, NODE_PATH), routeUrl]);
	assert.equal(Object.hasOwn(summary, join(f.root, 'src/xml/1.0/ed5.ts')), false);
	assert.equal(Object.hasOwn(summary, join(f.root, 'desktop/index.ts')), false);
	assert.equal(readFileSync(originalPath, 'utf8'), original); assert.equal(JSON.stringify(profile), original);
	assert.equal(readFileSync(nodePath, 'utf8'), nodeBytes); assert.equal(JSON.stringify(node), nodeBytes);
});

test('Lightscaper union rejects a missing unproved explicit portable repository source', t => {
	const f = fixture(t), profile = browserProfile('portable');
	const map = profile['source-map-cache'][profile.result[0]!.url]!.data;
	map.sources = ['file:///__soundscaper_repo__/src/lightscaper/missing.mjs'];
	map.x_soundscaper_source_sha256 = [null]; delete map.sourcesContent;
	const original = JSON.stringify(profile);
	assert.throws(() => rebaseCoverageProfileSources(profile, f.root), { code: 'ENOENT' });
	assert.equal(JSON.stringify(profile), original);
});
