/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepairFixture, REPAIR_BYTES } from './helpers/media-catalog-original-repair-fixture.ts';

for (const kind of ['write', 'close'] as const) void test(`repair fixture retirement releases and joins a held ${kind} after failed work`, { timeout: 15_000 }, async context => {
	const fixture = await createRepairFixture(context, 'opfs'), held = fixture.opfs.hold(kind);
	const previous = fixture.row(), roots = fixture.roots();
	const pending = fixture.media.restoreCatalogOriginalBody(fixture.binding, new Blob([REPAIR_BYTES]));
	try {
		await held.entered;
		const retiring = fixture.close(); assert.equal(fixture.close(), retiring, 'actual retirement is cached before abort dispatch');
		await assert.rejects(pending, { name: 'AbortError' }); await retiring;
		assert.deepEqual(fixture.row(), previous); assert.deepEqual(fixture.roots(), roots);
		assert.equal(fixture.opfs.files.size, 1, 'only the modeled retained original survives fixture retirement');
	} finally { held.release(); await pending.catch(() => undefined); await fixture.close(); }
});

void test('repair fixture retirement releases an entered staged abort before joining maintenance', { timeout: 15_000 }, async context => {
	const fixture = await createRepairFixture(context, 'opfs'), held = fixture.opfs.hold('write'), stop = new AbortController();
	const previous = fixture.row(), roots = fixture.roots(), reason = new DOMException('caller stops repair', 'AbortError');
	const pending = fixture.media.restoreCatalogOriginalBody(fixture.binding, new Blob([REPAIR_BYTES]), { signal: stop.signal });
	let abort: ReturnType<typeof fixture.opfs.hold> | undefined;
	try {
		await held.entered; abort = fixture.opfs.hold('abort'); stop.abort(reason); held.release(); await abort.entered;
		await fixture.close(); await assert.rejects(pending, error => error === reason);
		assert.deepEqual(fixture.row(), previous); assert.deepEqual(fixture.roots(), roots); assert.equal(fixture.opfs.files.size, 1);
	} finally { held.release(); abort?.release(); await pending.catch(() => undefined); await fixture.close(); }
});
