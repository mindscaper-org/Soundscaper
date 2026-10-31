/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Blob } from 'node:buffer';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { fixture, test, begin } from './helpers/lightscaper-native-restore-claim-fixture-current.ts';
import type { Scopes } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';
const KEY = 'photo-library:native-selected-v1';
type Selected = Readonly<{ scope: Readonly<object>; catalogId: string; selectionToken: string }>;
function selected(scopes: Scopes, name = 'Native library'): Promise<Selected> {
	const method: unknown = Reflect.get(scopes, 'openSelected'); assert.equal(typeof method, 'function');
	return Reflect.apply(method as (options: Readonly<{ name: string }>) => Promise<Selected>, scopes, [{ name }]);
}
void test('Native selected initialization persists a real empty default Catalog before vending its actual scope', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const first = await selected(f.scopes), components = await f.scopes.openComponents(first.scope);
		try {
			const root = await components.catalog.loadCatalog(first.catalogId); assert.ok(root); assert.equal(root.name, 'Native library'); assert.equal(root.photoCount, 0); assert.equal(root.revision, 0);
			const again = await selected(f.scopes, 'Ignored later name'); assert.equal(again.catalogId, first.catalogId); assert.equal(again.selectionToken, first.selectionToken);
			const anchor = await Settings.open({ appDataPath: f.directory, scope: 'anchor' });
			try { assert.deepEqual(await anchor.readLibraryAnchorEntryCurrentV1(KEY), { present: true, value: {
				schemaVersion: 1, kind: 'native-photo-library-selection', selectionToken: first.selectionToken, catalogId: first.catalogId, namespaceToken: null } }); }
			finally { await anchor.close(); }
		} finally { await components.close(); }
	});
});
void test('Native selected initialization refuses physically occupied undefined or oversized pointer values', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const anchor = await Settings.open({ appDataPath: f.directory, scope: 'anchor' });
		try {
			await anchor.settingsRepository.put(KEY, undefined); await assert.rejects(selected(f.scopes)); assert.deepEqual(await anchor.settingsRepository.readEntry(KEY), { present: true, value: undefined });
			await anchor.settingsRepository.put(KEY, new Blob([new Uint8Array(8192)])); await assert.rejects(selected(f.scopes), RangeError);
		} finally { await anchor.close(); }
	});
});
void test('Native restore selection mismatch refuses before allocating a new generation', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const current = await selected(f.scopes); const wrong = current.selectionToken === 'a'.repeat(32) ? 'b'.repeat(32) : 'a'.repeat(32);
		await assert.rejects(begin(f.scopes, 'restored-catalog', { expectedSelectionToken: wrong }));
		assert.equal((await f.scopes.readAllocationPage()).allocations.length, 0);
		const candidate = await begin(f.scopes, 'restored-catalog', { expectedSelectionToken: current.selectionToken }); await candidate.close(); candidate.retireRole('unpublished');
	});
});
void test('Native restore fences and joins actual selected component writers before candidate authority', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const current = await selected(f.scopes), components = await f.scopes.openComponents(current.scope);
		const bytes = new Uint8Array([1, 2, 3, 4]), sha = createHash('sha256').update(bytes).digest('hex');
		const writer = await components.media.beginAssetWrite('idle-before-restore', {}, { expectedBytes: bytes.length, expectedSha256: sha });
		let candidate: Awaited<ReturnType<typeof begin>> | undefined;
		try {
			candidate = await begin(f.scopes, 'restored-catalog', { expectedSelectionToken: current.selectionToken });
			await assert.rejects(writer.write(bytes)); await assert.rejects(components.catalog.loadCatalog(current.catalogId));
			await assert.rejects(f.scopes.openComponents(current.scope));
		} finally { await writer.abort(); await components.close(); if (candidate) { await candidate.close(); candidate.retireRole('unpublished'); } }
	});
});
void test('Native restore role retirement permits a later candidate without keeping stale selected authority', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const current = await selected(f.scopes), first = await begin(f.scopes, 'first-restored', { expectedSelectionToken: current.selectionToken });
		await first.close(); first.retireRole('unpublished');
		const reopened = await selected(f.scopes); assert.equal(reopened.selectionToken, current.selectionToken);
		await assert.rejects(f.scopes.openComponents(current.scope));
		const actual = await f.scopes.openComponents(reopened.scope); await actual.close();
		const second = await begin(f.scopes, 'second-restored', { expectedSelectionToken: reopened.selectionToken }); await second.close(); second.retireRole('unpublished');
	});
});
