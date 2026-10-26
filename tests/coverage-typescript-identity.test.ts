/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { compactV8Coverage } from '../scripts/lib/v8-coverage-compaction.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const TYPESCRIPT = [
	'export function classify(value: number): string {',
	'\tif (value > 0) return "positive";',
	'\treturn "other";',
	'}',
	'export function neverCalled(value: number): number {',
	'\treturn value + 1;',
	'}',
	'',
].join('\n');

interface FileCoverage {
	fnMap: Record<string, { name: string; loc: { start: { line: number }; end: { line: number } } }>;
	f: Record<string, number>;
	statementMap: Record<string, { start: { line: number } }>;
	s: Record<string, number>;
}

interface RawCoverage {
	result: unknown[];
	'source-map-cache'?: Record<string, unknown>;
}

for (const variant of ['native first', 'tsx first', 'one process', 'separate shards', 'recompacted'] as const) {
	test(`native TypeScript and tsx retain distinct offsets (${variant})`, () => {
		const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-typescript-coverage-'));
		try {
			writeFileSync(join(workspace, 'package.json'), '{"type":"module"}');
			mkdirSync(join(workspace, 'src'));
			const source = join(workspace, 'src/measured.ts');
			writeFileSync(source, TYPESCRIPT);
			const raw = join(workspace, 'raw');
			const shards = join(workspace, 'shards');
			mkdirSync(shards);
			for (const native of variant === 'tsx first' ? [false, true] : [true, false]) {
				const directory = variant === 'separate shards' ? join(raw, String(native)) : raw;
				const loader = native ? [] : ['--import', import.meta.resolve('tsx')];
				execFileSync(process.execPath, [
					...loader, '--input-type=module', '--eval',
					`import { classify } from ${JSON.stringify(pathToFileURL(source).href)}; classify(${native ? 1 : -1});`,
				], { cwd: ROOT, env: { ...process.env, NODE_V8_COVERAGE: directory } });
				if (variant === 'separate shards') {
					writeFileSync(join(shards, `${native}.json`), JSON.stringify(compactV8Coverage(directory, workspace)));
				}
			}
			if (variant === 'one process') {
				// Model a process loading both layouts at one URL, using real V8
				// offsets and the single cache entry Node can retain for that URL.
				const profiles = readdirSync(raw).map(name => JSON.parse(readFileSync(join(raw, name), 'utf8')) as RawCoverage);
				rmSync(raw, { recursive: true });
				mkdirSync(raw);
				writeFileSync(join(raw, 'combined.json'), JSON.stringify({
					result: profiles.flatMap(profile => profile.result),
					'source-map-cache': Object.assign({}, ...profiles.map(profile => profile['source-map-cache'])),
				}));
			}
			if (variant !== 'separate shards') {
				writeFileSync(join(shards, 'merged.json'), JSON.stringify(compactV8Coverage(raw, workspace)));
			}
			if (variant === 'recompacted') {
				const recompact = join(workspace, 'recompact');
				mkdirSync(recompact);
				writeFileSync(join(recompact, 'merged.json'), JSON.stringify(compactV8Coverage(shards, workspace)));
				rmSync(shards, { recursive: true });
				mkdirSync(shards);
				writeFileSync(join(shards, 'merged.json'), readFileSync(join(recompact, 'merged.json')));
			}
			const report = join(workspace, 'report');
			execFileSync(resolve(ROOT, 'node_modules/.bin/c8'), [
				'report', '--exclude-after-remap', `--temp-directory=${shards}`,
				`--reports-dir=${report}`, '--reporter=json', '--include=src/**/*.ts',
			], { cwd: workspace });
			const coverage = JSON.parse(readFileSync(join(report, 'coverage-final.json'), 'utf8')) as Record<string, FileCoverage>;
			assert.deepEqual(Object.keys(coverage), [source], 'only the original source is scored');
			const file = coverage[source]!;
			for (const [name, covered] of [['classify', true], ['neverCalled', false]] as const) {
				const matches = Object.entries(file.fnMap).filter(([, fn]) => fn.name === name);
				assert.equal(matches.length, 1, `${name} must be counted once across both executable layouts: ${JSON.stringify(matches)}`);
				assert.equal(file.f[matches[0]![0]]! > 0, covered, `${name} retains its actual execution`);
			}
			for (const line of [2, 3]) {
				const statements = Object.entries(file.statementMap).filter(([, span]) => span.start.line === line);
				assert.ok(statements.length > 0);
				assert.ok(statements.every(([id]) => file.s[id]! > 0), `both classify outcomes cover source line ${line}`);
			}
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});
}
