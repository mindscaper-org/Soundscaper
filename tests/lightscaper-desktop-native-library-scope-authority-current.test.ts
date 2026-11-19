/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { nativeScopeIntegrationFixtureCurrentV1 as fixture, scopeGenerationRootCurrentV1 as generation,
	scopeLibraryRootCurrentV1 as library, SCOPE_CATALOG_CURRENT_V1 as CATALOG } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';

test('Lightscaper forged Proxy and copied allocation descriptors cannot become native scope capabilities', async () => {
	await fixture(async f => {
		const scope = await f.scopes.allocate(CATALOG), allocation = f.scopes.describe(scope); assert.ok(allocation); let traps = 0;
		const proxy = new Proxy({}, { get() { traps++; throw Error('Forged scope get'); }, ownKeys() { traps++; throw Error('Forged scope ownKeys'); }, getPrototypeOf() { traps++; throw Error('Forged scope prototype'); } });
		for (const candidate of [proxy, allocation, { ...allocation }]) {
			assert.throws(() => Reflect.apply(f.scopes.describe, f.scopes, [candidate]));
			await assert.rejects(Reflect.apply(f.scopes.openComponents, f.scopes, [candidate]));
		}
		assert.equal(traps, 0); assert.deepEqual(await readdir(join(generation(f.directory, allocation.namespaceToken), 'app-data')), []);
	});
});

test('Lightscaper genuine scope capability is bound to its actual manager and is fenced after that manager closes', async () => {
	await fixture(async first => {
		const scope = await first.scopes.allocate(CATALOG), allocation = first.scopes.describe(scope); assert.ok(allocation);
		await fixture(async foreign => {
			assert.throws(() => foreign.scopes.describe(scope)); await assert.rejects(foreign.scopes.openComponents(scope));
		});
		await first.scopes.close(); assert.throws(() => first.scopes.describe(scope)); await assert.rejects(first.scopes.openComponents(scope));
		const reopened = await first.reopen(); assert.throws(() => reopened.describe(scope)); await assert.rejects(reopened.openComponents(scope));
		const resumed = await reopened.resume(allocation.namespaceToken); assert.deepEqual(reopened.describe(resumed), allocation);
	});
});

for (const copied of [false, true]) test(`Lightscaper actual ${copied ? 'copied generation' : 'foreign'} manifest refuses resume and component open before any child stores appear`, async () => {
	await fixture(async f => {
		const a = f.scopes.describe(await f.scopes.allocate(CATALOG)), scopeB = await f.scopes.allocate(CATALOG), b = f.scopes.describe(scopeB); assert.ok(a && b);
		const target = join(generation(f.directory, b.namespaceToken), 'owner.json'), before = await readFile(target);
		const replacement = copied ? await readFile(join(generation(f.directory, a.namespaceToken), 'owner.json')) : Buffer.from('{"kind":"foreign"}');
		await writeFile(target, replacement);
		try {
			await assert.rejects(f.scopes.resume(b.namespaceToken)); await assert.rejects(f.scopes.openComponents(scopeB));
			assert.deepEqual(await readFile(target), replacement); assert.deepEqual(await readdir(join(generation(f.directory, b.namespaceToken), 'app-data')), []);
		} finally { await writeFile(target, before); }
	});
});

test('Lightscaper resume requires the actual durable registry row rather than adopting an orphan matching manifest', async () => {
	await fixture(async f => {
		const allocation = f.scopes.describe(await f.scopes.allocate(CATALOG)); assert.ok(allocation); await f.scopes.close();
		const db = new DatabaseSync(join(library(f.directory), 'native-photo-library-scopes.sqlite3'));
		try { db.prepare('DELETE FROM native_photo_library_scopes WHERE namespace_token=?').run(allocation.namespaceToken); } finally { db.close(); }
		const reopened = await f.reopen(); await assert.rejects(reopened.resume(allocation.namespaceToken));
		assert.deepEqual(await readdir(join(generation(f.directory, allocation.namespaceToken), 'app-data')), []);
	});
});

test('Lightscaper allocation list scans64 actual registry rows with legal empty continuation and complete65-row paging', async () => {
	await fixture(async f => {
		const allocations = [];
		for (let index = 0; index < 64; index++) { const value = f.scopes.describe(await f.scopes.allocate(CATALOG)); assert.ok(value); allocations.push(value); }
		const first = await f.scopes.readAllocationPage(); assert.equal(first.allocations.length, 64); assert.ok(first.afterToken);
		assert.ok(first.allocations.every(item => item.state === 'created')); assert.equal(first.afterToken, first.allocations[63]?.allocation.namespaceToken);
		const empty = await f.scopes.readAllocationPage(first.afterToken); assert.deepEqual(empty.allocations, []); assert.equal(empty.afterToken, null);
		const extra = f.scopes.describe(await f.scopes.allocate(CATALOG)); assert.ok(extra); allocations.push(extra);
		const restart = await f.scopes.readAllocationPage(), last = await f.scopes.readAllocationPage(restart.afterToken);
		assert.equal(restart.allocations.length, 64); assert.equal(last.allocations.length, 1); assert.equal(last.afterToken, null);
		assert.deepEqual([...restart.allocations, ...last.allocations].map(item => item.allocation.namespaceToken), allocations.map(value => value.namespaceToken).sort());
		await f.scopes.close(); const reopened = await f.reopen(); assert.equal((await reopened.readAllocationPage()).allocations.length, 64);
	});
});
