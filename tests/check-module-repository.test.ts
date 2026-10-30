/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { collectRepositoryModulePlan, readModuleExecutionPlan } from '../scripts/lib/check-module-repository.ts';

function fixture(): { root: string; write: (file: string, source: string) => void; git: (...args: string[]) => string } {
	const root = mkdtempSync(join(tmpdir(), 'scape-module-repository-'));
	const write = (file: string, source: string): void => {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), source);
	};
	const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	git('init', '--quiet');
	git('config', 'user.name', 'Module fixture');
	git('config', 'user.email', 'module-fixture@example.invalid');
	write('.gitignore', 'plan.json\n.wrangler/\ncoverage/\n');
	write('config/module-policy.json', JSON.stringify({ schemaVersion: 1, globalInputs: ['config/module-policy.json'], modules: [{
		id: 'imaging', sourcePrefixes: ['src/common/imaging/'], publicFiles: ['src/common/imaging/pixels.ts'],
		dependencies: [], nodeTests: ['tests/pixels.test.ts'], products: [], independent: true, coverageScope: 'editor',
	}] }));
	write('src/common/imaging/pixels.ts', 'export const pixel = 1;');
	write('tests/pixels.test.ts', 'import { pixel } from "../src/common/imaging/pixels.ts"; void pixel;');
	write('tests/unrelated.test.ts', 'export {};');
	write('assets/reference.bin', 'original asset');
	git('add', '.');
	git('commit', '--quiet', '-m', 'fixture baseline');
	return { root, write, git };
}

test('repository planning observes uncommitted and untracked inputs and a pinned base', () => {
	const { root, write, git } = fixture();
	try {
		const revision = git('rev-parse', 'HEAD');
		write('src/common/imaging/pixels.ts', 'export const pixel = 2;');
		const result = collectRepositoryModulePlan(root, { base: revision });
		assert.match(result.sourceFingerprint, /^[a-f0-9]{64}$/u);
		assert.equal(result.mode, 'focused');
		assert.deepEqual(result.nodeTests, ['tests/pixels.test.ts']);
		assert.equal(result.comparisonRevision, revision);
		write('unknown-input.bin', 'new unclassified input');
		const untracked = collectRepositoryModulePlan(root, { base: revision });
		assert.equal(untracked.mode, 'full');
		assert.ok(untracked.reasons.some(reason => reason.includes('unknown-input.bin')));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('deleting a source still selects the tests that imported its base revision', () => {
	const { root, git } = fixture();
	try {
		const revision = git('rev-parse', 'HEAD');
		rmSync(join(root, 'src/common/imaging/pixels.ts'));
		const result = collectRepositoryModulePlan(root, { base: revision });
		assert.ok(result.nodeTests.includes('tests/pixels.test.ts'));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('repository plans include consumers of production product substitutions', () => {
	const { root, write, git } = fixture();
	try {
		write('src/common/editor/ui/application-menu-product-runtime.js', 'export const menu = 0;');
		write('src/soundscaper/editor-application-menu-product-runtime.js', 'import { pixel } from "../common/imaging/pixels.ts"; export const menu = pixel;');
		write('tests/product-menu.test.ts', 'import { menu } from "../src/common/editor/ui/application-menu-product-runtime.js"; void menu;');
		git('add', '.');
		git('commit', '--quiet', '-m', 'product substitution fixture');
		const base = git('rev-parse', 'HEAD');
		write('src/common/imaging/pixels.ts', 'export const pixel = 2;');
		assert.ok(collectRepositoryModulePlan(root, { base }).nodeTests.includes('tests/product-menu.test.ts'));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing comparison revision produces a full plan instead of an empty success', () => {
	const { root } = fixture();
	try {
		const result = collectRepositoryModulePlan(root, { base: 'missing-ref' });
		assert.equal(result.mode, 'full');
		assert.equal(result.nodeTests.length, 2);
		assert.ok(result.reasons.some(reason => /comparison|revision/u.test(reason)));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('main and release callers can force a complete plan despite certified module targets', () => {
	const { root } = fixture();
	try {
		const result = collectRepositoryModulePlan(root, { full: true });
		assert.equal(result.mode, 'full');
		assert.equal(result.nodeTests.length, 2);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('execution plans reject stale revisions and paths outside the discovered test inventory', () => {
	const { root } = fixture();
	try {
		const plan = collectRepositoryModulePlan(root, { modules: ['imaging'] });
		const file = join(root, 'plan.json');
		writeFileSync(file, JSON.stringify(plan));
		assert.deepEqual(readModuleExecutionPlan(root, file).nodeTests, ['tests/pixels.test.ts']);
		writeFileSync(file, JSON.stringify({ ...plan, revision: '0'.repeat(40) }));
		assert.throws(() => readModuleExecutionPlan(root, file), /revision/u);
		writeFileSync(file, JSON.stringify({ ...plan, nodeTests: ['../outside.test.ts'] }));
		assert.throws(() => readModuleExecutionPlan(root, file), /test|path/u);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('execution plans reject source edits, added tests, and binary changes at the same HEAD', () => {
	for (const mutation of ['source', 'test', 'binary']) {
		const { root, write, git } = fixture();
		try {
			const binary = Buffer.alloc(1024 * 1024 + 3);
			if (mutation === 'binary') writeFileSync(join(root, 'assets/reference.bin'), binary);
			const plan = collectRepositoryModulePlan(root, { modules: ['imaging'] });
			const file = join(root, 'plan.json');
			writeFileSync(file, JSON.stringify(plan));
			if (mutation === 'source') write('src/common/imaging/pixels.ts', 'export const pixel = 2;');
			else if (mutation === 'test') write('tests/new.test.ts', 'export {};');
			else {
				binary[binary.length - 1] = 255;
				writeFileSync(join(root, 'assets/reference.bin'), binary);
			}
			assert.equal(git('rev-parse', 'HEAD'), plan.revision);
			assert.throws(() => readModuleExecutionPlan(root, file), /source fingerprint|source inputs/u);
		} finally { rmSync(root, { recursive: true, force: true }); }
	}
});

test('ignored build output cannot stale a valid execution plan', () => {
	const { root, write } = fixture();
	try {
		const plan = collectRepositoryModulePlan(root, { modules: ['imaging'] });
		const file = join(root, 'plan.json');
		writeFileSync(file, JSON.stringify(plan));
		write('.wrangler/module-cache.bin', 'new cached build bytes');
		write('coverage/profile.json', '{"result":[]}');
		assert.equal(readModuleExecutionPlan(root, file).sourceFingerprint, plan.sourceFingerprint);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('execution fingerprints are portable between clean checkouts of the same revision', () => {
	const { root } = fixture();
	const copy = mkdtempSync(join(tmpdir(), 'scape-module-repository-copy-'));
	try {
		const plan = collectRepositoryModulePlan(root, { modules: ['imaging'] });
		execFileSync('git', ['clone', '--quiet', '--no-hardlinks', root, copy]);
		const file = join(copy, 'plan.json');
		writeFileSync(file, JSON.stringify(plan));
		assert.equal(readModuleExecutionPlan(copy, file).sourceFingerprint, plan.sourceFingerprint);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(copy, { recursive: true, force: true });
	}
});
