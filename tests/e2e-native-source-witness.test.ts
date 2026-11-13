/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { type TestContext } from 'node:test';

import { validateNativeSourceWitnesses } from '../scripts/lib/e2e-native-source-witness.mjs';
import { sha256Digest, stableSha256Digest } from '../scripts/lib/e2e-coverage-integrity.mjs';
import { E2E_REPOSITORY_URL_PREFIX } from '../scripts/lib/e2e-coverage-prefixes.mjs';

const surface = 'browser-chromium-soundscaper-renderer';
const otherSurface = 'browser-chromium-framescaper-renderer';
const path = 'src/common/native-witness-example.ts';
const url = 'file:///__soundscaper_e2e__/soundscaper/witness.mjs';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
interface Range { startOffset: number; endOffset: number; count: number }
interface FunctionCoverage { functionName: string; isBlockCoverage: boolean; ranges: Range[] }
interface Entry { scriptId: string; url: string; functions: FunctionCoverage[] }

function vlq(value: number): string {
	let remaining = value < 0 ? -value * 2 + 1 : value * 2;
	let encoded = '';
	do { const digit = remaining % 32; remaining = Math.floor(remaining / 32); encoded += alphabet[digit + (remaining > 0 ? 32 : 0)]; } while (remaining > 0);
	return encoded;
}

function fixture(t: TestContext, generated: string, options: { original?: string; originalLine?: (line: number) => number | null; ownedColumn?: (line: number, column: number) => boolean } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'native-source-witness-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, 'raw')); mkdirSync(join(root, 'executables'));
	const artifactPath = 'executables/witness.mjs'; const executable = join(root, artifactPath);
	writeFileSync(executable, generated);
	execFileSync(process.execPath, [executable], { env: { ...process.env, NODE_V8_COVERAGE: join(root, 'raw') } });
	const rawPath = readdirSync(join(root, 'raw')).find(name => name.endsWith('.json')); assert.ok(rawPath);
	const raw = JSON.parse(readFileSync(join(root, 'raw', rawPath), 'utf8')) as { result: Entry[] };
	const entry = raw.result.find(candidate => candidate.url === pathToFileURL(executable).href); assert.ok(entry);
	entry.url = url;
	const original = options.original ?? generated;
	mkdirSync(join(root, 'src/common'), { recursive: true }); writeFileSync(join(root, path), original);
	let previousSource = 0, previousLine = 0, previousColumn = 0;
	const mappings = generated.split('\n').map((text, line) => {
		const targetLine = options.originalLine ? options.originalLine(line) : line;
		let previousGeneratedColumn = 0;
		return Array.from({ length: text.length }, (_, column) => {
			const source = targetLine === null || options.ownedColumn?.(line, column) === false ? 0 : 1, originalLine = source === 0 ? 0 : targetLine ?? 0;
			const fields = [column - previousGeneratedColumn, source - previousSource, originalLine - previousLine, column - previousColumn];
			previousGeneratedColumn = column; previousSource = source; previousLine = originalLine; previousColumn = column;
			return fields.map(vlq).join('');
		}).join(',');
	}).join(';');
	const data = { version: 3, sources: ['file:///__soundscaper_external__/wrapper.js', `${E2E_REPOSITORY_URL_PREFIX}${path}`], sourcesContent: ['', original], names: [], mappings };
	const profile = { result: [entry], 'source-map-cache': { [url]: { data } } };
	const script = { id: 'soundscaper/witness.mjs', surface, coverageUrl: url, artifactPath, sha256: sha256Digest(generated), sourceMapSha256: stableSha256Digest(data), sources: [path] };
	const nodeSource = { path, origin: 'repository', sha256: sha256Digest(original), surfaces: [surface, otherSurface], layer: 'node-deterministic', policyEntry: { nativeWitness: { spec: 'tests/browser/example.spec.js', title: 'actual native work', surfaces: [surface] } } };
	return { repositoryRoot: root, artifactRoot: root, profiles: [{ profile, surface }], scripts: [script], nodeSources: [nodeSource], entry, data };
}

test('a positive actual mapped source function qualifies; a loaded root and uncalled function do not', t => {
	const executed = fixture(t, 'export function value() { return 1; }\nvalue();\n');
	assert.deepEqual(validateNativeSourceWitnesses(executed).failures, []);
	assert.equal(validateNativeSourceWitnesses(executed).witnesses[0]?.kind, 'function');
	const uncalled = fixture(t, 'export function value() { return 1; }\n');
	assert.match(validateNativeSourceWitnesses(uncalled).failures.join('\n'), /positive mapped.*function/u);
});

test('another surface cannot lend its positive function to the declared witness surface', t => {
	const example = fixture(t, 'export function value() { return 1; }\nvalue();\n');
	example.profiles[0]!.surface = otherSurface;
	assert.match(validateNativeSourceWitnesses(example).failures.join('\n'), /soundscaper.*positive mapped/u);
});

test('every declared witness surface needs its own positive function', t => {
	const example = fixture(t, 'export function value() { return 1; }\nvalue();\n');
	example.nodeSources[0]!.policyEntry.nativeWitness.surfaces.push(otherSurface);
	assert.match(validateNativeSourceWitnesses(example).failures.join('\n'), /framescaper.*positive mapped/u);
});

test('a bundler wrapper containing only an uncalled mapped function cannot act as that source function', t => {
	const generated = 'function wrapper() {\nfunction value() { return 1; }\nconst initialized = 1;\n}\nwrapper();\n';
	const original = 'function value() { return 1; }\nconst initialized = 1;\n';
	const example = fixture(t, generated, { original, originalLine: line => line === 1 || line === 2 ? line - 1 : null });
	assert.match(validateNativeSourceWitnesses(example).failures.join('\n'), /positive mapped.*function/u);
});

test('implicit class member initializers count as functions and cannot use a root-only fallback', t => {
	const uncalled = fixture(t, 'export class Example { value = 1; }\n');
	assert.match(validateNativeSourceWitnesses(uncalled).failures.join('\n'), /positive mapped.*function/u);
	const executed = fixture(t, 'export class Example { value = 1; }\nnew Example();\n');
	assert.deepEqual(validateNativeSourceWitnesses(executed).failures, []);
});

test('a genuine no-function source needs a mapped executed statement, not a declaration or root span alone', t => {
	const constant = fixture(t, 'export const value = 1;\n');
	assert.deepEqual(validateNativeSourceWitnesses(constant).failures, []);
	assert.equal(validateNativeSourceWitnesses(constant).witnesses[0]?.kind, 'statement');
	const comment = fixture(t, '// mapped comment and root only\n');
	assert.match(validateNativeSourceWitnesses(comment).failures.join('\n'), /positive mapped.*statement/u);
});

test('no-function fallback respects a zero-count statement inside an uncalled wrapper', t => {
	const generated = 'function wrapper() {\nconst value = 1;\n}\n';
	const example = fixture(t, generated, { original: 'const value = 1;\n', originalLine: line => line === 1 ? 0 : null });
	assert.match(validateNativeSourceWitnesses(example).failures.join('\n'), /positive mapped/u);
});

test('unauthenticated maps, changed source content and unmapped scripts cannot establish native ownership', t => {
	const example = fixture(t, 'export function value() { return 1; }\nvalue();\n');
	example.data.sourcesContent[1] = 'export const changed = true;\n';
	assert.ok(validateNativeSourceWitnesses(example).failures.length > 0);
	example.scripts[0]!.sourceMapSha256 = stableSha256Digest(example.data);
	assert.match(validateNativeSourceWitnesses(example).failures.join('\n'), /source.*SHA|source.*bytes/u);
});

test('exact-source witnesses do not create false cross-source branch failures in a shared first-party function', t => {
	const example = fixture(t, 'export function value(flag) {\nif (flag) return 1;\nreturn 0;\n}\nvalue(true);\n', { ownedColumn: (line, column) => line !== 1 || column >= 'if (flag) '.length });
	example.data.sources[0] = `${E2E_REPOSITORY_URL_PREFIX}src/common/another-owner.ts`;
	example.data.sourcesContent[0] = example.data.sourcesContent[1]!;
	example.scripts[0]!.sources.push('src/common/another-owner.ts');
	example.scripts[0]!.sourceMapSha256 = stableSha256Digest(example.data);
	assert.deepEqual(validateNativeSourceWitnesses(example).failures, []);
});

test('wrapper export tokens mapped only to an uncalled source function signature do not establish body execution', t => {
	const generated = 'function wrapper() {\nfunction veryLongFunctionName() { return 1; }\nconst v = 1;\n}\nwrapper();\n';
	const example = fixture(t, generated, { original: 'function veryLongFunctionName() { return 1; }\n', originalLine: line => line === 1 || line === 2 ? 0 : null });
	assert.match(validateNativeSourceWitnesses(example).failures.join('\n'), /positive mapped.*function/u);
});

test('a called wrapper cannot credit a mapped source body under its untaken branch', t => {
	function conditional(enabled: boolean) {
		const generated = `function wrapper(enabled) {\nif (enabled) {\nreturn 1;\n}\nreturn 0;\n}\nwrapper(${enabled});\n`;
		const example = fixture(t, generated, {
			original: 'function target() {\nreturn 1;\n}\n',
			originalLine: line => line === 2 ? 1 : null,
		});
		example.data.sources[0] = `${E2E_REPOSITORY_URL_PREFIX}src/common/caller.ts`;
		example.data.sourcesContent[0] = generated;
		example.scripts[0]!.sources.push('src/common/caller.ts');
		example.scripts[0]!.sourceMapSha256 = stableSha256Digest(example.data);
		return example;
	}
	const skipped = conditional(false);
	const wrapper = skipped.entry.functions.find(fn => fn.functionName === 'wrapper'); assert.ok(wrapper);
	assert.ok(wrapper.ranges[0]!.count > 0, 'the actual wrapper executed');
	assert.ok(wrapper.ranges.some(range => range.count === 0 && range.startOffset <= 'function wrapper(enabled) {\nif (enabled) {\n'.length
		&& 'function wrapper(enabled) {\nif (enabled) {\nreturn 1;'.length <= range.endOffset), 'the mapped target body did not execute');
	assert.match(validateNativeSourceWitnesses(skipped).failures.join('\n'), /positive mapped.*function/u);
	assert.deepEqual(validateNativeSourceWitnesses(conditional(true)).failures, [], 'the same mapped body qualifies when its actual branch executes');
});
