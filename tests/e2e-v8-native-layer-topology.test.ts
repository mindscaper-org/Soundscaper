/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { type TestContext } from 'node:test';

import { e2eExecutableCoverageKey, sha256Digest, stableSha256Digest } from '../scripts/lib/e2e-coverage-integrity.mjs';

import { validateE2ERawV8Topology as validate } from '../scripts/lib/e2e-v8-topology.mjs';
const nativePath = 'src/native.ts', nodePath = 'src/node.ts';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
interface Fn { functionName: string; isBlockCoverage: boolean; ranges: { startOffset: number; endOffset: number; count: number }[] }
interface Entry { scriptId: string; url: string; functions: Fn[] }

function fixture(context: TestContext, mixed = false) {
	const source = 'function container() {\n  class Instance {\n    member = 1;\n  }\n  return new Instance();\n}\n'
		+ (mixed ? 'function nodeOnly(value) { return value ? 1 : 2; }\n' : '') + 'container();\n' + (mixed ? 'nodeOnly(true);\n' : '');
	return actual(context, source, (row, column) => row === 2 && column >= 4 && column < 14 ? 1 : mixed && row === 6 ? 2 : 0, mixed);
}

function actual(context: TestContext, source: string, owner: (row: number, column: number) => number, mixed: boolean) {
	const root = mkdtempSync(join(tmpdir(), 'native-layer-projection-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, 'raw')); writeFileSync(join(root, 'module.mjs'), source);
	execFileSync(process.execPath, [join(root, 'module.mjs')], { env: { ...process.env, NODE_V8_COVERAGE: join(root, 'raw') } });
	const rawPath = join(root, 'raw', readdirSync(join(root, 'raw'))[0]!);
	const rawBytes = readFileSync(rawPath), raw = JSON.parse(rawBytes.toString('utf8')) as { result: Entry[] };
	const entry = raw.result.find(value => value.url === pathToFileURL(join(root, 'module.mjs')).href); assert.ok(entry);
	let previousSource = 0, previousLine = 0, previousColumn = 0;
	const mappings = source.split('\n').map((line, row) => {
		let previousGeneratedColumn = 0;
		return [...line].map((_character, column) => {
			const index = owner(row, column);
			const fields = [column - previousGeneratedColumn, index - previousSource, row - previousLine, column - previousColumn];
			previousGeneratedColumn = column; previousSource = index; previousLine = row; previousColumn = column;
			return fields.map(vlq).join('');
		}).join(',');
	}).join(';');
	const data = { version: 3, sources: ['file:///__external__/wrapper.js', `file:///__soundscaper_repo__/${nativePath}`,
		...(mixed ? [`file:///__soundscaper_repo__/${nodePath}`] : [])], names: [], mappings };
	const binding = { sha256: sha256Digest(source), sourceMapSha256: stableSha256Digest(data), sources: [nativePath, ...(mixed ? [nodePath] : [])] };
	const script = { id: 'module', artifactPath: 'module.mjs', coverageUrl: entry.url, ...binding, coverageKey: e2eExecutableCoverageKey(binding) };
	const profile = { result: [entry], 'source-map-cache': { [entry.url]: { data } } };
	return { root, entry, profile, script, rawPath, rawBytes,
		run: (value = profile, qualifiedNodeSources = new Set<string>()) => validate({ artifactRoot: root, profiles: [value], scripts: [script], qualifiedNodeSources }) as string[] };
}

function vlq(value: number): string {
	let remaining = value < 0 ? -value * 2 + 1 : value * 2, result = '';
	do { const digit = remaining % 32; remaining = Math.floor(remaining / 32); result += alphabet[digit + (remaining ? 32 : 0)]; } while (remaining);
	return result;
}

test('native-only implicit member code keeps its containing explicit function in the original denominator', context => {
	const value = fixture(context); assert.deepEqual(value.run(), []);
	const omitted = structuredClone(value.profile); omitted.result[0]!.functions = omitted.result[0]!.functions.filter(fn => fn.functionName !== 'container');
	assert.match(value.run(omitted).join('\n'), /missing the source-derived explicit function span/u);
	assert.deepEqual(readFileSync(value.rawPath), value.rawBytes, 'the original actual V8 profile remains unchanged');
});

test('an unrelated qualified source cannot change the native-only source-derived owner inventory', context => {
	const value = fixture(context); const omitted = structuredClone(value.profile);
	omitted.result[0]!.functions = omitted.result[0]!.functions.filter(fn => fn.functionName !== 'container');
	assert.match(value.run(omitted, new Set(['src/unrelated.ts'])).join('\n'), /missing the source-derived explicit function span/u);
});

test('a mixed script retains the native wrapper while a qualified sibling function may have partial native branches', context => {
	const value = fixture(context, true); const qualified = new Set([nodePath]);
	assert.deepEqual(value.run(value.profile, qualified), []);
	const omitted = structuredClone(value.profile); omitted.result[0]!.functions = omitted.result[0]!.functions.filter(fn => fn.functionName !== 'container');
	assert.match(value.run(omitted, qualified).join('\n'), /missing the source-derived explicit function span/u);
	const missingRoot = structuredClone(value.profile); missingRoot.result[0]!.functions = missingRoot.result[0]!.functions.filter(fn => fn.ranges[0]!.endOffset !== readFileSync(join(value.root, 'module.mjs'), 'utf8').length);
	assert.match(value.run(missingRoot, qualified).join('\n'), /missing the source-derived root/u);
});

test('an owner mixing native statements and qualified source branches retains its entire strict branch topology', context => {
	const source = 'function mixed(value) {\n  const nativeValue = 1;\n  if (value) return nativeValue;\n  return 0;\n}\nmixed(true);\n';
	const value = actual(context, source, row => row === 1 ? 1 : row === 2 || row === 3 ? 2 : 0, true);
	assert.match(value.run(value.profile, new Set([nodePath])).join('\n'), /branch topology/u);
});

test('mixed native roots keep their full branches while wholly qualified roots retain their mandatory actual root record', context => {
	const source = 'const flag = true;\nif (flag) globalThis.__nativeProjection = 1;\n';
	const mixed = actual(context, source, row => row === 0 ? 1 : 2, true);
	assert.match(mixed.run(mixed.profile, new Set([nodePath])).join('\n'), /branch topology/u);
	const nodeOnly = actual(context, source, () => 2, true);
	nodeOnly.script.sources = [nodePath];
	nodeOnly.script.coverageKey = e2eExecutableCoverageKey(nodeOnly.script);
	assert.deepEqual(nodeOnly.run(nodeOnly.profile, new Set([nodePath])), []);
	const missingRoot = structuredClone(nodeOnly.profile); missingRoot.result[0]!.functions = [];
	assert.match(nodeOnly.run(missingRoot, new Set([nodePath])).join('\n'), /missing the source-derived root/u);
});
