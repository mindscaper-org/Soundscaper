/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { linkedGrantsFixtureCurrentV1 as fixture, LINKED_GRANT_TEST_OPTIONS_CURRENT_V1 as options,
	grantAuthorizeCurrentV1 as authorize, type Grant } from './helpers/lightscaper-native-linked-grants-integration-fixture-current.ts';

const table = 'native_photo_linked_root_grants';
function isGrantDatabase(db: DatabaseSync): boolean {
	return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(table)?.name === table;
}
function observeExec(before: (db: DatabaseSync, sql: string) => void, after: (db: DatabaseSync, sql: string) => void): () => void {
	const original = DatabaseSync.prototype.exec;
	DatabaseSync.prototype.exec = function (sql: string): void {
		before(this, sql); Reflect.apply(original, this, [sql]); after(this, sql);
	};
	return () => { DatabaseSync.prototype.exec = original; };
}

for (const mutation of ['authorize', 'revoke'] as const) void test(`Lightscaper grant ${mutation} trigger refusal leaves the actual old durable rows`, options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(), existing: Grant | null = mutation === 'revoke' ? await authorize(owner) : null, peer = f.peer();
		try {
			peer.exec(mutation === 'authorize'
				? "CREATE TRIGGER deny_grant BEFORE INSERT ON native_photo_linked_root_grants BEGIN SELECT RAISE(ABORT,'grant write refused'); END"
				: "CREATE TRIGGER deny_grant BEFORE UPDATE ON native_photo_linked_root_grants WHEN NEW.revoked=1 BEGIN SELECT RAISE(ABORT,'grant revoke refused'); END");
			try { await assert.rejects(mutation === 'authorize' ? owner.authorize() : owner.revoke(existing!.grantId)); }
			finally { peer.exec('DROP TRIGGER deny_grant'); }
			const rows = peer.prepare('SELECT grant_id,revision,revoked FROM native_photo_linked_root_grants ORDER BY grant_id').all();
			assert.deepEqual(rows.map(row => [row.grant_id, row.revision, row.revoked]), existing ? [[existing.grantId, 0, 0]] : []);
			if (existing) assert.deepEqual(await owner.revalidate(existing.grantId), existing);
		} finally { peer.close(); }
	});
});

for (const mutation of ['authorize', 'revoke'] as const) void test(`Lightscaper grant ${mutation} actual COMMIT denial rolls back all row state`, options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(), existing = mutation === 'revoke' ? await authorize(owner) : null;
		let observed: DatabaseSync | undefined, refused = 0;
		const restore = observeExec((db, sql) => {
			if (!/^BEGIN IMMEDIATE\s*;?$/iu.test(sql.trim()) || !isGrantDatabase(db)) return;
			observed = db; db.setAuthorizer((action, target) => {
				if (action === constants.SQLITE_TRANSACTION && target === 'COMMIT') { refused++; return constants.SQLITE_DENY; }
				return constants.SQLITE_OK;
			});
		}, () => undefined);
		try { await assert.rejects(mutation === 'authorize' ? owner.authorize() : owner.revoke(existing!.grantId)); }
		finally { observed?.setAuthorizer(null); restore(); }
		assert.equal(refused, 1); assert.ok(observed); assert.equal(observed.isTransaction, false);
		const page = await owner.readPage(); assert.deepEqual(page.grants, existing ? [existing] : []); assert.equal(f.notifications(), 0);
	});
});

for (const mutation of ['authorize', 'revoke'] as const) void test(`Lightscaper grant ${mutation} real COMMIT ACK survives opaque caller abort and reentrant close`, options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(), existing = mutation === 'revoke' ? await authorize(owner) : null, caller = new AbortController();
		let commits = 0, closing: Promise<void> | undefined, reflected = 0;
		const opaque = new Proxy({}, { get() { reflected++; throw new Error('opaque abort reason inspected'); }, ownKeys() { reflected++; return []; } });
		const restore = observeExec(() => undefined, (db, sql) => {
			if (!/^COMMIT\s*;?$/iu.test(sql.trim()) || !isGrantDatabase(db)) return;
			commits++; caller.abort(opaque); closing = owner.close();
		});
		let delivered: Grant | boolean | null;
		try { delivered = mutation === 'authorize' ? await owner.authorize({ signal: caller.signal }) : await owner.revoke(existing!.grantId, { signal: caller.signal }); }
		finally { restore(); }
		assert.equal(commits, 1); assert.ok(closing); await closing; assert.equal(reflected, 0);
		const peer = f.peer(); try {
			const rows = peer.prepare('SELECT grant_id,revision,revoked FROM native_photo_linked_root_grants').all(); assert.equal(rows.length, 1);
			if (mutation === 'authorize') { assert.ok(delivered && typeof delivered === 'object'); assert.equal(rows[0]?.grant_id, delivered.grantId); assert.equal(rows[0]?.revoked, 0); }
			else { assert.equal(delivered, true); assert.equal(rows[0]?.grant_id, existing?.grantId); assert.equal(rows[0]?.revoked, 1); assert.equal(rows[0]?.revision, 1); }
		} finally { peer.close(); }
	});
});
