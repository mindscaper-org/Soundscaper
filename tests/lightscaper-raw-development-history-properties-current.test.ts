/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV4, type ImageDevelopStateThroughV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { createPhotoDevelopWorkspaceCurrentV1, commitPhotoDevelopWorkspaceCurrentV1, selectPhotoDevelopHistoryCurrentV1,
	savePhotoDevelopSnapshotCurrentV1, restorePhotoDevelopSnapshotCurrentV1, parsePhotoDevelopWorkspaceCurrentV1,
	serializePhotoDevelopWorkspaceCurrentV1 } from '../src/lightscaper/catalog/photo-develop-workspace-current-v1.ts';
import { rawPropertySpec, rawPropertyRecipe, rawDevelopPropertiesFixture, RAW_PROPERTY_MODES, RAW_PROPERTY_TIME } from './helpers/lightscaper-raw-development-properties-current-fixture.ts';

const step = (label: string) => ({ label, createdAt: RAW_PROPERTY_TIME });
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

test('Current4 canonical neutral serialization has a literal stable golden without upgrading old Process1', () => {
	const old = defaultImageDevelopStateV1(), before = JSON.stringify(old);
	const current = normalizeImageDevelopStateV4({ ...old, processVersion: 4, repairs: { schemaVersion: 1, spots: [] }, rawDevelopment: { schemaVersion: 1, mode: 'canonical' } });
	assert.equal(JSON.stringify(current), '{"processVersion":4,"effects":[],"geometry":{"crop":null,"rotationDegrees":0,"flipHorizontal":false,"flipVertical":false},"masks":[],"maskBindings":[],"repairs":{"schemaVersion":1,"spots":[]},"rawDevelopment":{"schemaVersion":1,"mode":"canonical"}}');
	assert.equal(JSON.stringify(old), before); assert.equal(old.processVersion, 1);
});

test('seed2026102701 generated mixed Process1 through4 branches and snapshots retain every fixed RAW mode and inactive recipe', () => {
	fc.assert(fc.property(rawPropertySpec, fc.nat(), (spec, offset) => {
		const recipes = [1, 2, 3].map(process => rawPropertyRecipe(spec, undefined, process as 1 | 2 | 3));
		recipes.push(...RAW_PROPERTY_MODES.map(mode => rawPropertyRecipe({ ...spec, mode })));
		let workspace = createPhotoDevelopWorkspaceCurrentV1(defaultImageDevelopStateV1(), step('Original'));
		let expected: readonly Readonly<ImageDevelopStateThroughV4>[] = [defaultImageDevelopStateV1()];
		for (const recipe of recipes) {
			workspace = commitPhotoDevelopWorkspaceCurrentV1(workspace, recipe, step('Generated'));
			if (!same(expected.at(-1), recipe)) expected = [...expected, recipe];
			assert.deepEqual(workspace.entries.map(entry => entry.develop), expected);
		}
		workspace = savePhotoDevelopSnapshotCurrentV1(workspace, { id: 'saved', name: spec.values.name, createdAt: RAW_PROPERTY_TIME });
		const snapshot = expected.at(-1)!, captured = JSON.stringify(workspace), cursor = offset % (expected.length - 1);
		workspace = selectPhotoDevelopHistoryCurrentV1(workspace, cursor);
		assert.equal(workspace.schemaVersion, 4); assert.deepEqual(workspace.entries.map(entry => entry.develop), expected);
		const branch = rawPropertyRecipe({ ...spec, mode: spec.mode === 'headroom' ? 'recovery' : 'headroom' });
		workspace = commitPhotoDevelopWorkspaceCurrentV1(workspace, branch, step('Branch'));
		expected = same(expected[cursor], branch) ? expected : [...expected.slice(0, cursor + 1), branch];
		assert.deepEqual(workspace.entries.map(entry => entry.develop), expected);
		assert.deepEqual(workspace.snapshots[0]!.develop, snapshot);
		workspace = restorePhotoDevelopSnapshotCurrentV1(workspace, { snapshotId: 'saved', ...step('Restore') });
		assert.deepEqual(workspace.entries[workspace.cursor]!.develop, snapshot);
		assert.equal(workspace.schemaVersion, 4);
		assert.deepEqual(parsePhotoDevelopWorkspaceCurrentV1(serializePhotoDevelopWorkspaceCurrentV1(workspace)), workspace);
		assert.ok(captured.includes('"mode":"canonical"') && captured.includes('"mode":"headroom"') && captured.includes('"mode":"recovery"'));
	}), { seed: 2026102701, numRuns: 48, endOnFailure: true });
});

test('seed2026102702 actual owned RAW Current4 history persists mixed branches and retained snapshots without changing custody', { timeout: 120_000 }, async context => {
	const visited = { cases: 0, process: { 1: 0, 2: 0, 3: 0, 4: 0 }, mode: { canonical: 0, headroom: 0, recovery: 0 }, joined: 0 };
	await fc.assert(fc.asyncProperty(rawPropertySpec, async spec => {
		const f = await rawDevelopPropertiesFixture();
		try {
			const index = await f.addRaw(), initial = await f.photo(index), custody = await f.custody();
			const active = () => f.photo(index).then(photo => photo.versions.find(version => version.id === photo.activeVersionId)!);
			let expected = [initial.versions[0]!.develop];
			for (const process of [1, 2, 3] as const) {
				const recipe = rawPropertyRecipe(spec, f.resources, process); await f.record(recipe, index);
				visited.process[process]++;
				if (!same(expected.at(-1), recipe)) expected = [...expected, recipe];
			}
			for (const mode of RAW_PROPERTY_MODES) {
				const recipe = rawPropertyRecipe({ ...spec, mode }, f.resources); await f.record(recipe, index);
				visited.process[4]++; visited.mode[mode]++;
				if (!same(expected.at(-1), recipe)) expected = [...expected, recipe];
				const version = await active(); assert.equal(version.workspace!.schemaVersion, 4);
				assert.deepEqual(version.workspace!.entries.map(entry => entry.develop), expected);
			}
			const snapshot = expected.at(-1)!;
			await f.apply({ type: 'save-develop-snapshot', id: 'retained', name: spec.values.name, createdAt: RAW_PROPERTY_TIME }, index);
			await f.apply({ type: 'select-develop-history', cursor: 1 }, index);
			await f.reopen(); const selected = await active();
			assert.deepEqual(selected.develop, expected[1]); assert.deepEqual(selected.workspace!.entries.map(entry => entry.develop), expected);
			assert.deepEqual(selected.workspace!.snapshots[0]!.develop, snapshot);
			assert.equal(selected.workspace!.schemaVersion, 4);
			const branch = rawPropertyRecipe(spec, f.resources, 2); await f.record(branch, index, 'Legacy branch');
			expected = [...expected.slice(0, 2), branch];
			assert.deepEqual((await active()).workspace!.entries.map(entry => entry.develop), expected);
			await f.apply({ type: 'restore-develop-snapshot', snapshotId: 'retained', ...step('Restore RAW') }, index);
			const saved = await f.photo(index); await f.reopen(); assert.deepEqual(await f.photo(index), saved);
			assert.deepEqual((await active()).develop, snapshot); assert.deepEqual(await f.custody(), custody);
			const before = await f.photo(index), version = before.versions.find(value => value.id === before.activeVersionId)!;
			assert.equal(version.develop.processVersion, 4);
			for (const patch of [{ processVersion: 5 }, { rawDevelopment: { schemaVersion: 2, mode: spec.mode } },
				{ rawDevelopment: { schemaVersion: 1, mode: 'future' } }, { rawDevelopment: { schemaVersion: 1, mode: spec.mode, decoder: 'invented' } }]) {
				await assert.rejects(Reflect.apply(f.record, f, [{ ...snapshot, ...patch }, index]) as Promise<unknown>);
				assert.deepEqual(await f.photo(index), before);
			}
			assert.throws(() => normalizePhotoDocumentCurrentV1({ ...before, versions: before.versions.map(value => value.id === before.activeVersionId
				? { ...value, develop: { ...value.develop, rawDevelopment: { schemaVersion: 1, mode: 'headroom' } } } : value) }));
			assert.deepEqual(await f.custody(), custody);
			assert.deepEqual(f.workerCounts(), { canonical: 0, recovery: 0 }); visited.cases++;
		} finally { await f.close(); assert.deepEqual(f.workerCounts(), { canonical: 0, recovery: 0 }); visited.joined++; }
	}), { seed: 2026102702, numRuns: 4, endOnFailure: true, includeErrorInReport: true });
	assert.equal(visited.cases, 4); assert.equal(visited.joined, 4);
	assert.deepEqual(visited.mode, { canonical: 4, headroom: 4, recovery: 4 });
	assert.deepEqual(visited.process, { 1: 4, 2: 4, 3: 4, 4: 12 });
	context.diagnostic(JSON.stringify({ kind: 'current4-history-property-coverage', seed: 2026102702, ...visited }));
});
