/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs, { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';

import { materializeV8CoverageUnion, rebasePortableV8Profile } from '../scripts/lib/e2e-coverage-runner.mjs';
import { coverageFileRecords, stableSha256Digest } from '../scripts/lib/e2e-coverage-integrity.mjs';
import { validateRawV8Surface } from '../scripts/lib/e2e-coverage-contract.mjs';
import { createRawV8SurfaceValidation, type RawV8Profile } from '../scripts/lib/e2e-v8-profile-observations.ts';
import { withV8MaterializationSpool } from '../scripts/lib/e2e-v8-materialization-spool.ts';
import { validateE2ERawV8Topology, validateE2ERawV8TopologyGroups } from '../scripts/lib/e2e-v8-topology.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const source = 'const motion = 1;\n';
const firstUrl = 'file:///__soundscaper_e2e__/motion/first.js';
const secondUrl = 'file:///__soundscaper_e2e__/motion/second.js';

function profile(url = firstUrl) {
	return { result: [{ url, functions: [{ functionName: '', isBlockCoverage: true,
		ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] }] }], 'source-map-cache': {} };
}

function fixture() {
	const workspace = mkdtempSync(join(tmpdir(), 'motion-coverage-union-'));
	const artifactRoot = join(workspace, 'artifact');
	const reportDirectory = join(workspace, 'report');
	mkdirSync(join(artifactRoot, 'executables'), { recursive: true });
	writeFileSync(join(artifactRoot, 'executables/motion.js'), source);
	const scripts = [firstUrl, secondUrl].map((coverageUrl, index) => ({
		id: `motion-${index}`, surface: `motion-${index}`, coverageUrl, coverageKey: 'same-motion-body',
		artifactPath: 'executables/motion.js', sourceMapSha256: null as string | null, sources: ['generated/motion.js'],
	}));
	const inventory = { scripts, sources: [{ path: 'generated/motion.js', origin: 'artifact', artifactPath: 'executables/motion.js' }] };
	const surfaces = scripts.map(script => {
		const surfaceDirectory = join(artifactRoot, script.surface);
		const directory = join(surfaceDirectory, 'v8');
		mkdirSync(directory, { recursive: true });
		for (const name of ['a.json', 'b.json']) writeFileSync(join(directory, name), JSON.stringify(profile(script.coverageUrl)));
		return { surfaceDirectory, manifest: { surface: script.surface, coverage: { path: 'v8', files: coverageFileRecords(directory) } } };
	});
	return { workspace, artifactRoot, reportDirectory, inventory, surfaces, repositoryRoot };
}

function fakeC8(context: TestContext, onRun: (args: readonly string[]) => void = () => {}) {
	context.mock.method(childProcess, 'spawnSync', new Proxy(childProcess.spawnSync, {
		apply(_target, _receiver, args: unknown[]) {
			const argv = args[1] as string[];
			onRun(argv);
			const reports = argv.find(argument => argument.startsWith('--reports-dir='));
			assert.ok(reports);
			writeFileSync(join(reports.slice('--reports-dir='.length), 'coverage-final.json'), '{}');
			return { pid: 0, output: [], stdout: '', stderr: '', status: 0, signal: null };
		},
	}));
}

test('Motion union spools the first rebased profile before parsing the next profile', context => {
	const data = fixture();
	const later = join(data.surfaces[0]!.surfaceDirectory, 'v8/b.json');
	writeFileSync(later, JSON.stringify({ ...profile(), 'motion-memory-boundary': 'parse-second-profile' }));
	data.surfaces[0]!.manifest.coverage.files = coverageFileRecords(join(data.surfaces[0]!.surfaceDirectory, 'v8'));
	let firstWritten = false;
	let boundaryObserved = false;
	fakeC8(context);
	context.mock.method(fs, 'writeFileSync', new Proxy(fs.writeFileSync, {
		apply(target, receiver, args: unknown[]) {
			const result = Reflect.apply(target, receiver, args) as unknown;
			if (typeof args[0] === 'string' && basename(args[0]) === 'coverage-motion-0-000000-a.json') firstWritten = true;
			return result;
		},
	}));
	context.mock.method(JSON, 'parse', new Proxy(JSON.parse, {
		apply(target, receiver, args: unknown[]) {
			if (typeof args[0] === 'string' && args[0].includes('"motion-memory-boundary":"parse-second-profile"')) {
				assert.equal(firstWritten, true, 'the first rebased profile must be on disk before the next raw profile is parsed');
				boundaryObserved = true;
			}
			return Reflect.apply(target, receiver, args) as unknown;
		},
	}));
	syncBuiltinESMExports();
	try {
		const result = materializeV8CoverageUnion(data);
		assert.deepEqual(result.failures, []);
		assert.equal(boundaryObserved, true);
	} finally {
		context.mock.restoreAll(); syncBuiltinESMExports();
		rmSync(data.workspace, { recursive: true, force: true });
	}
});

test('Motion union preserves original rebased bytes, URLs, filenames and c8 command across surfaces', context => {
	const data = fixture();
	let invoked = false;
	fakeC8(context, args => {
		invoked = true;
		assert.deepEqual(args, ['report', `--config=${join(data.reportDirectory, 'c8.json')}`,
			`--temp-directory=${join(data.reportDirectory, 'v8-rebased')}`,
			`--reports-dir=${join(data.reportDirectory, 'istanbul')}`, '--reporter=json', '--allowExternal', '--exclude-after-remap']);
		const directory = join(data.reportDirectory, 'v8-rebased');
		const expected = data.inventory.scripts.flatMap((script, surfaceIndex) => ['a.json', 'b.json'].map((name, index) => {
			const filename = `coverage-${script.surface}-${String(surfaceIndex * 2 + index).padStart(6, '0')}-${name}`;
			assert.equal(readFileSync(join(directory, filename), 'utf8'),
				JSON.stringify(rebasePortableV8Profile(profile(script.coverageUrl), data.inventory, repositoryRoot, data.artifactRoot)));
			return filename;
		}));
		assert.deepEqual(readdirSync(directory).sort(), expected.sort());
	});
	syncBuiltinESMExports();
	try {
		const result = materializeV8CoverageUnion(data);
		assert.equal(invoked, true);
		assert.deepEqual(result.observedCoverageUrls, [firstUrl, firstUrl, secondUrl, secondUrl]);
		assert.deepEqual(result.failures, []);
		assert.equal(readFileSync(join(data.reportDirectory, 'c8.json'), 'utf8'), JSON.stringify({ all: false,
			exclude: ['**/node_modules/**', '**/vendor/**'],
			extension: ['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts', '.jsx', '.tsx'], include: ['**/*'] }));
	} finally {
		context.mock.restoreAll(); syncBuiltinESMExports();
		rmSync(data.workspace, { recursive: true, force: true });
	}
});

test('Motion incremental surface validation preserves Array API diagnostics and profile indexes', () => {
	const scripts = [{ surface: 'motion', coverageUrl: firstUrl }];
	const profiles = [null, {}, { result: [{ url: '' }, { url: firstUrl }, { url: secondUrl }] }];
	const validation = createRawV8SurfaceValidation('motion', scripts);
	for (const value of profiles) validation.observe(value);
	const expected = ['motion raw V8 profile 1 has no result array.', 'motion raw V8 profile 2 has no result array.',
		'motion raw V8 profile 3 has an entry without a URL.', `motion reported un-inventoried executable script ${secondUrl}.`];
	assert.deepEqual(validation.finish(), expected);
	assert.deepEqual(validateRawV8Surface(profiles, 'motion', { scripts }), expected);
	assert.deepEqual(createRawV8SurfaceValidation('motion', scripts).finish(), validateRawV8Surface([], 'motion', { scripts }));
});

test('Motion invalid surfaces retain observed URLs but cannot enter the c8 union', context => {
	const data = fixture();
	const first = data.surfaces[0]!;
	writeFileSync(join(first.surfaceDirectory, 'v8/a.json'), JSON.stringify(profile(secondUrl)));
	first.manifest.coverage.files = coverageFileRecords(join(first.surfaceDirectory, 'v8'));
	let invoked = false;
	fakeC8(context, () => {
		invoked = true;
		assert.deepEqual(readdirSync(join(data.reportDirectory, 'v8-rebased')).sort(),
			['coverage-motion-1-000000-a.json', 'coverage-motion-1-000001-b.json']);
	});
	syncBuiltinESMExports();
	try {
		const result = materializeV8CoverageUnion(data);
		assert.equal(invoked, true);
		assert.deepEqual(result.observedCoverageUrls, [secondUrl, firstUrl, secondUrl, secondUrl]);
		assert.deepEqual(result.failures, [`motion-0 reported un-inventoried executable script ${secondUrl}.`]);
	} finally {
		context.mock.restoreAll(); syncBuiltinESMExports();
		rmSync(data.workspace, { recursive: true, force: true });
	}
});

test('Motion topology failures still materialize accepted profiles with unchanged failure order', context => {
	const data = fixture();
	for (const item of data.surfaces) {
		for (const name of ['a.json', 'b.json']) writeFileSync(join(item.surfaceDirectory, 'v8', name),
			JSON.stringify({ result: [{ url: data.inventory.scripts[data.surfaces.indexOf(item)]!.coverageUrl, functions: [] }] }));
		item.manifest.coverage.files = coverageFileRecords(join(item.surfaceDirectory, 'v8'));
	}
	let invoked = false;
	fakeC8(context, () => { invoked = true; });
	syncBuiltinESMExports();
	try {
		const result = materializeV8CoverageUnion(data);
		assert.equal(invoked, true);
		assert.deepEqual(result.failures, ['motion-0 is missing the source-derived root function span 0-18.']);
	} finally {
		context.mock.restoreAll(); syncBuiltinESMExports();
		rmSync(data.workspace, { recursive: true, force: true });
	}
});

test('Motion disk topology groups preserve alias order and map-only observations using the original validator', () => {
	const data = fixture();
	const map = { version: 3, sources: ['file:///__soundscaper_repo__/generated/motion.js'],
		sourcesContent: [source], names: [], mappings: 'AAAA' };
	for (const script of data.inventory.scripts) script.sourceMapSha256 = stableSha256Digest(map);
	const otherUrl = 'file:///__soundscaper_e2e__/motion/other.js';
	const otherSource = 'const other = 2;\n';
	writeFileSync(join(data.artifactRoot, 'executables/other.js'), otherSource);
	data.inventory.scripts.push({ id: 'other', surface: 'other', coverageUrl: otherUrl, coverageKey: 'independent-body',
		artifactPath: 'executables/other.js', sourceMapSha256: null, sources: ['generated/other.js'] });
	const other = profile(otherUrl);
	other.result[0]!.functions[0]!.ranges[0]!.endOffset = otherSource.length;
	const profiles: RawV8Profile[] = [other, profile(secondUrl), profile(firstUrl), { result: [], 'source-map-cache': {
		[firstUrl]: { data: map }, [secondUrl]: { data: map },
	} }];
	try {
		withV8MaterializationSpool(data.reportDirectory, data.inventory.scripts, spool => {
			const staged = spool.beginSurface('motion', value => value);
			for (const [index, value] of profiles.entries()) staged.write(`${index}.json`, value);
			staged.accept();
			const visited: string[] = [];
			const actual = validateE2ERawV8TopologyGroups({ artifactRoot: data.artifactRoot, scripts: data.inventory.scripts,
				observationsForGroup: (key: string) => { visited.push(key); return spool.observationsForGroup(key); } });
			assert.deepEqual(actual, validateE2ERawV8Topology({ artifactRoot: data.artifactRoot, scripts: data.inventory.scripts, profiles }));
			assert.deepEqual(actual, []);
			assert.deepEqual(visited, ['same-motion-body', 'independent-body']);
		});
		assert.deepEqual(readdirSync(data.reportDirectory), [], 'all group payloads retire after the validation scope');
	} finally { rmSync(data.workspace, { recursive: true, force: true }); }
});

test('Motion late parse errors remove staged groups while preserving prior rebased output', context => {
	const data = fixture();
	const previous = join(data.reportDirectory, 'v8-rebased');
	mkdirSync(previous, { recursive: true });
	writeFileSync(join(previous, 'prior.json'), 'prior authenticated output\n');
	const later = data.surfaces[1]!;
	writeFileSync(join(later.surfaceDirectory, 'v8/b.json'), '{');
	later.manifest.coverage.files = coverageFileRecords(join(later.surfaceDirectory, 'v8'));
	let invoked = false;
	fakeC8(context, () => { invoked = true; });
	syncBuiltinESMExports();
	try {
		assert.throws(() => materializeV8CoverageUnion(data), SyntaxError);
		assert.equal(invoked, false);
		assert.equal(readFileSync(join(previous, 'prior.json'), 'utf8'), 'prior authenticated output\n');
		assert.deepEqual(readdirSync(data.reportDirectory), ['v8-rebased']);
	} finally {
		context.mock.restoreAll(); syncBuiltinESMExports();
		rmSync(data.workspace, { recursive: true, force: true });
	}
});

test('Motion each parsed raw buffer remains bound to the manifest after integrity discovery', context => {
	const data = fixture();
	const first = data.surfaces[0]!;
	const later = join(first.surfaceDirectory, 'v8/b.json');
	const original = readFileSync(later, 'utf8');
	writeFileSync(join(first.surfaceDirectory, 'v8/a.json'), JSON.stringify({ ...profile(), 'motion-rewrite-next': true }));
	first.manifest.coverage.files = coverageFileRecords(join(first.surfaceDirectory, 'v8'));
	let changed = false;
	context.mock.method(JSON, 'parse', new Proxy(JSON.parse, {
		apply(target, receiver, args: unknown[]) {
			if (!changed && typeof args[0] === 'string' && args[0].includes('"motion-rewrite-next":true')) {
				writeFileSync(later, `${original}\n`); changed = true;
			}
			return Reflect.apply(target, receiver, args) as unknown;
		},
	}));
	syncBuiltinESMExports();
	try {
		assert.throws(() => materializeV8CoverageUnion(data), /coverage-file inventory or bytes do not match its manifest/u);
		assert.equal(changed, true);
		assert.deepEqual(readdirSync(data.reportDirectory), []);
	} finally {
		context.mock.restoreAll(); syncBuiltinESMExports();
		rmSync(data.workspace, { recursive: true, force: true });
	}
});

for (const family of ['group', 'rebased'] as const) {
	test(`Motion changed staged ${family} bytes refuse and preserve prior output`, () => {
		const data = fixture();
		const previous = join(data.reportDirectory, 'v8-rebased');
		mkdirSync(previous, { recursive: true });
		writeFileSync(join(previous, 'prior.json'), 'prior output\n');
		try {
			assert.throws(() => withV8MaterializationSpool(data.reportDirectory, data.inventory.scripts, spool => {
				const staged = spool.beginSurface('motion-0', value => value);
				staged.write('a.json', profile()); staged.accept();
				const stage = readdirSync(data.reportDirectory).find(name => name.startsWith('.v8-union-staging-'));
				assert.ok(stage);
				const directory = join(data.reportDirectory, stage, family === 'group' ? 'surface-0' : 'rebased');
				const name = readdirSync(directory).find(value => value.startsWith(family === 'group' ? 'group-' : 'coverage-'));
				assert.ok(name);
				const file = join(directory, name);
				writeFileSync(file, `${readFileSync(file, 'utf8')}\n`);
				if (family === 'group') spool.observationsForGroup('same-motion-body');
				else spool.publish(previous);
			}), /Staged V8 profile bytes changed/u);
			assert.equal(readFileSync(join(previous, 'prior.json'), 'utf8'), 'prior output\n');
			assert.deepEqual(readdirSync(data.reportDirectory), ['v8-rebased']);
		} finally { rmSync(data.workspace, { recursive: true, force: true }); }
	});
}

test('Motion added staged JSON refuses publication and preserves prior output', () => {
	const data = fixture();
	const previous = join(data.reportDirectory, 'v8-rebased');
	mkdirSync(previous, { recursive: true });
	writeFileSync(join(previous, 'prior.json'), 'prior output\n');
	try {
		assert.throws(() => withV8MaterializationSpool(data.reportDirectory, data.inventory.scripts, spool => {
			const staged = spool.beginSurface('motion-0', value => value);
			staged.write('a.json', profile()); staged.accept();
			const stage = readdirSync(data.reportDirectory).find(name => name.startsWith('.v8-union-staging-'));
			assert.ok(stage);
			writeFileSync(join(data.reportDirectory, stage, 'rebased/added.json'), JSON.stringify(profile()));
			spool.publish(previous);
		}), /Staged V8 profile membership changed/u);
		assert.equal(readFileSync(join(previous, 'prior.json'), 'utf8'), 'prior output\n');
		assert.deepEqual(readdirSync(data.reportDirectory), ['v8-rebased']);
	} finally { rmSync(data.workspace, { recursive: true, force: true }); }
});
