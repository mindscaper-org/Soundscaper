/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Check the serialized image with native SQLite, separately from the browser reader. */
export async function auditAudacityNativeSqlite(bytes, extension, inspect) {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-audacity-'));
	try {
		const path = join(directory, `Audacity project (export).${extension}`);
		await writeFile(path, bytes);
		const reader = new DatabaseSync(path, { readOnly: true });
		let primary;
		let checkpoint;
		try {
			reader.exec('BEGIN');
			assert.equal(reader.prepare('SELECT count(*) AS count FROM project').get().count, 1);
			// DBConnection::OpenStepByStep in the pinned Audacity 3 and 4 loaders.
			const safeConfig = 'PRAGMA busy_timeout = 5000; PRAGMA locking_mode = SHARED;'
				+ 'PRAGMA synchronous = NORMAL; PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;';
			primary = new DatabaseSync(path);
			primary.exec(safeConfig);
			checkpoint = new DatabaseSync(path);
			checkpoint.exec(safeConfig);
			assert.equal(primary.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
			assert.equal(primary.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
			assert.equal(checkpoint.prepare('SELECT count(*) AS count FROM autosave').get().count, 0);
			inspect(primary);
			inspect(checkpoint);
			return Object.freeze({ journalMode: 'wal', concurrentReader: true });
		} finally {
			checkpoint?.close();
			primary?.close();
			reader.close();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
