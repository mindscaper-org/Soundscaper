/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createCommittedRepositoryFixture } from './helpers/committed-repository-fixture.ts';

const files = new Map([
	['src/entry.js', 'export const value = 1;\n'],
	['config/policy.json', '{"enabled":true}\n'],
]);
const git = (root: string, ...arguments_: string[]): string => execFileSync('git', arguments_, {
	cwd: root, encoding: 'utf8',
}).trim();

test('repository fixture copies isolate tracked bytes, Git objects, index and refs', context => {
	const directory = mkdtempSync(join(tmpdir(), 'soundscaper-repository-copy-'));
	const repository = createCommittedRepositoryFixture(files);
	context.after(() => {
		repository.dispose();
		rmSync(directory, { recursive: true, force: true });
	});
	const first = join(directory, 'first');
	const second = join(directory, 'second');
	const third = join(directory, 'third');
	const revision = repository.copyTo(first);
	assert.equal(repository.copyTo(second), revision);
	const blob = git(first, 'rev-parse', 'HEAD:src/entry.js');

	writeFileSync(join(first, 'src/entry.js'), 'tampered source');
	writeFileSync(join(first, 'config/policy.json'), 'tampered policy');
	writeFileSync(join(first, '.git/index'), 'tampered index');
	writeFileSync(join(first, '.git/HEAD'), 'ref: refs/heads/missing\n');
	writeFileSync(join(first, '.git/config'), 'tampered configuration');
	const objectPath = join(first, '.git/objects', blob.slice(0, 2), blob.slice(2));
	chmodSync(objectPath, 0o644);
	writeFileSync(objectPath, 'tampered object');

	assert.equal(repository.copyTo(third), revision);
	for (const root of [second, third]) {
		assert.equal(git(root, 'rev-parse', 'HEAD'), revision);
		assert.equal(git(root, 'status', '--porcelain'), '');
		assert.equal(git(root, 'show', 'HEAD:src/entry.js'), files.get('src/entry.js')!.trim());
		for (const [path, value] of files) assert.equal(readFileSync(join(root, path), 'utf8'), value);
	}
});

test('repository fixture disposal leaves copies usable and permits a fresh seed', context => {
	const directory = mkdtempSync(join(tmpdir(), 'soundscaper-repository-reset-'));
	const repository = createCommittedRepositoryFixture(files);
	context.after(() => {
		repository.dispose();
		rmSync(directory, { recursive: true, force: true });
	});
	repository.dispose();
	const first = join(directory, 'first');
	const revision = repository.copyTo(first);
	repository.dispose();
	repository.dispose();
	assert.equal(git(first, 'rev-parse', 'HEAD'), revision);
	const second = join(directory, 'second');
	assert.equal(repository.copyTo(second), revision);
	assert.equal(git(second, 'status', '--porcelain'), '');
});

test('repository fixture commits exactly its supplied sources without requiring config files', context => {
	const directory = mkdtempSync(join(tmpdir(), 'soundscaper-repository-sources-'));
	const repository = createCommittedRepositoryFixture(new Map([['src/entry.js', 'export const value = 2;\n']]));
	context.after(() => {
		repository.dispose();
		rmSync(directory, { recursive: true, force: true });
	});
	const root = join(directory, 'repository');
	const revision = repository.copyTo(root);
	assert.equal(git(root, 'rev-parse', 'HEAD'), revision);
	assert.equal(git(root, 'ls-tree', '-r', '--name-only', 'HEAD'), 'src/entry.js');
	assert.equal(git(root, 'show', 'HEAD:src/entry.js'), 'export const value = 2;');
});
