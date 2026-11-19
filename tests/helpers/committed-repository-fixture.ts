/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Reuse the immutable Git seed; every caller receives independent writable files. */
export function createCommittedRepositoryFixture(files: ReadonlyMap<string, string | Uint8Array>) {
	let seed: Readonly<{ directory: string; revision: string }> | undefined;
	function initialize() {
		const directory = mkdtempSync(join(tmpdir(), 'soundscaper-repository-seed-'));
		try {
			for (const [path, value] of files) {
				const destination = join(directory, path);
				mkdirSync(dirname(destination), { recursive: true });
				writeFileSync(destination, value);
			}
			for (const arguments_ of [
				['init', '--quiet', '--template='],
				['config', 'user.name', 'Coverage Fixture'],
				['config', 'user.email', 'coverage@example.invalid'],
				['add', '--', ...files.keys()],
				['commit', '--quiet', '-m', 'fixture'],
			]) {
				const outcome = spawnSync('git', arguments_, {
					cwd: directory, encoding: 'utf8', env: {
						...process.env,
						GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
						GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
					},
				});
				assert.equal(outcome.status, 0, outcome.stderr);
			}
			const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' });
			assert.equal(revision.status, 0, revision.stderr);
			return { directory, revision: revision.stdout.trim() };
		} catch (error) {
			rmSync(directory, { recursive: true, force: true });
			throw error;
		}
	}
	return {
		copyTo(destination: string): string {
			seed ??= initialize();
			// cpSync copies contents rather than hardlinking mutable Git objects or indexes.
			cpSync(seed.directory, destination, { recursive: true });
			return seed.revision;
		},
		dispose(): void {
			if (!seed) return;
			rmSync(seed.directory, { recursive: true, force: true });
			seed = undefined;
		},
	};
}
