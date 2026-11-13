/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { neutralizeQualifiedNodeMap, rejectCoverageIgnoreDirectives, rejectUnsupportedNodeControlFlow } from '../scripts/lib/e2e-coverage-node-contract.mjs';
import { copyQualifiedNodeEvidence, readQualifiedNodeEvidenceIndex } from '../scripts/lib/e2e-coverage-node-transport.mjs';
import { sha256Digest } from '../scripts/lib/e2e-coverage-integrity.mjs';

test('analysis removes only the authenticated terminal map comment, retaining UTF16 geometry and executable bytes', () => {
	const body = 'export const value = "🎵";\n';
	const trailer = '//# sourceMappingURL=data:application/json;base64,e30=\n';
	const source = body + trailer;
	const module = { inlineSourceMap: { startOffset: body.length, endOffset: source.length, trailerSha256: sha256Digest(trailer) } };
	const analysis = neutralizeQualifiedNodeMap(source, module);
	assert.equal(analysis.length, source.length);
	assert.equal(analysis.slice(0, body.length), body);
	assert.equal(analysis.split('\n').length, source.split('\n').length);
	assert.doesNotMatch(analysis, /sourceMappingURL/u);
	assert.throws(() => neutralizeQualifiedNodeMap(source, { inlineSourceMap: { ...module.inlineSourceMap, startOffset: 0 } }), /terminal|digest/u);
	assert.throws(() => neutralizeQualifiedNodeMap('//# sourceMappingURL=x\n' + source, module), /exactly one|terminal/u);
});

test('coverage ignore directives cannot shrink a qualified denominator, while literal strings remain ordinary code', () => {
	for (const directive of ['c8 ignore next', 'v8 ignore start', 'istanbul ignore file', 'c8 ignore next 2']) {
		assert.throws(() => rejectCoverageIgnoreDirectives(`/* ${directive} */\nexport const value = 1;`, 'example.ts'), /ignore directive/u);
	}
	assert.doesNotThrow(() => rejectCoverageIgnoreDirectives('export const text = "c8 ignore next";', 'example.ts'));
});

test('unsupported independent branch producers cannot qualify by collapsing runtime ranges', () => {
	for (const source of [
		'while (value) { run(); }', 'do { run(); } while (value);', 'for (;;) { break; }',
		'for (const key in value) { run(key); }', 'for (const item of value) { run(item); }',
		'switch (value) { case 1: run(); }', 'function run(value = 1) { return value; }',
		'const { value = 1 } = input;', 'value ||= 1;', 'value &&= 1;', 'value ??= 1;',
	]) assert.throws(() => rejectUnsupportedNodeControlFlow(source, 'example.js'), /unsupported independent Node branch topology/u, source);
	assert.doesNotThrow(() => rejectUnsupportedNodeControlFlow('function run(value) { if (value) return value?.name ?? "x"; return value ? 1 : 2; }', 'example.js'));
});

test('evidence transport preserves every raw byte and rejects stale hashes, unsafe locators and symbolic links', () => {
	const root = mkdtempSync(join(tmpdir(), 'e2e-node-transport-'));
	try {
		const input = join(root, 'input'), output = join(root, 'output');
		mkdirSync(join(input, 'captures'), { recursive: true });
		writeFileSync(join(input, 'manifest.json'), '{"kind":"fixture"}\n');
		writeFileSync(join(input, 'captures', '7-0.json'), '{"actual":"raw"}\n');
		const locator = copyQualifiedNodeEvidence({ inputRoots: [input], outputRoot: output });
		assert.ok(locator);
		const entries = readQualifiedNodeEvidenceIndex({ root: output, locator });
		assert.equal(entries.length, 1);
		assert.deepEqual(readFileSync(join(entries[0]!, 'captures/7-0.json')), readFileSync(join(input, 'captures/7-0.json')));
		writeFileSync(join(entries[0]!, 'captures/7-0.json'), 'changed');
		assert.throws(() => readQualifiedNodeEvidenceIndex({ root: output, locator }), /hash|digest|bytes/u);
		assert.throws(() => readQualifiedNodeEvidenceIndex({ root: output, locator: { ...locator, path: '../index.json' } }), /relative|escape/u);
		assert.throws(() => copyQualifiedNodeEvidence({ inputRoots: [input], outputRoot: join(input, '..nested') }), /must not be inside/u);
		symlinkSync(join(input, 'manifest.json'), join(input, 'forged.json'));
		assert.throws(() => copyQualifiedNodeEvidence({ inputRoots: [input], outputRoot: join(root, 'rejected') }), /regular|symbolic/u);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
