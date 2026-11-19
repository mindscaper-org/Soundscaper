/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import type { ImageDevelopStateThroughV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import type { ImageDevelopSelectionV4 } from '../src/common/editor/imaging/image-develop-settings-contract-v4.ts';
import { copyImageDevelopSettingsV4, mergeImageDevelopSettingsV4 } from '../src/common/editor/imaging/image-develop-settings-v4.ts';
import { createImageDevelopPresetV4, parseImageDevelopPresetV4, serializeImageDevelopPresetV4, type ImageDevelopPresetV4 } from '../src/common/editor/imaging/image-develop-preset-v4.ts';
import { normalizePhotoDevelopPresetRowV3 } from '../src/lightscaper/storage/photo-develop-preset-row-v3.ts';
import { createPhotoLibraryRestoreRuntimeCurrentV1 } from '../src/lightscaper/photo-library-restore-runtime-current-v1.ts';
import { readRepairBackupArchive } from './helpers/lightscaper-repair-backup-current-fixture.ts';
import { rawPropertySpec, rawPropertyRecipe, rawDevelopPropertiesFixture, RAW_PROPERTY_MODES, RAW_PROPERTY_TIME,
	type RawPropertySpec } from './helpers/lightscaper-raw-development-properties-current-fixture.ts';

const selections: fc.Arbitrary<ImageDevelopSelectionV4> = fc.record({ effectTypes: fc.uniqueArray(fc.constantFrom('white-balance-v1', 'tone-ladder-v1', 'chroma-v1'), { maxLength: 3 }),
	geometry: fc.boolean(), localAdjustments: fc.boolean(), repairs: fc.boolean(), rawDevelopment: fc.boolean() });
const mode = (state: ImageDevelopStateThroughV4) => state.processVersion === 4 ? state.rawDevelopment.mode : 'canonical';
const repairs = (state: ImageDevelopStateThroughV4) => state.processVersion === 3 || state.processVersion === 4 ? state.repairs : { schemaVersion: 1, spots: [] };
type Effect = ImageDevelopStateThroughV4['effects'][number];
const semantic = (effect: Effect) => ({ type: effect.type, enabled: effect.enabled, params: effect.params });
const selectedEffect = (state: ImageDevelopStateThroughV4, selection: ImageDevelopSelectionV4, effect: Effect) =>
	state.maskBindings.some(binding => binding.effectId === effect.id) ? selection.localAdjustments
		: selection.effectTypes === 'all' || selection.effectTypes.includes(effect.type);

/** Independent donation model: group membership/order and authored source
 * selection, without the production merge, allocator or normalizer. */
function assertDonation(donor: ImageDevelopStateThroughV4, target: ImageDevelopStateThroughV4,
	selection: ImageDevelopSelectionV4, result: ImageDevelopStateThroughV4): void {
	assert.equal(mode(result), selection.rawDevelopment ? mode(donor) : mode(target));
	if (target.processVersion === 4 || selection.rawDevelopment && donor.processVersion === 4) assert.equal(result.processVersion, 4);
	else assert.notEqual(result.processVersion, 4);
	assert.deepEqual(result.geometry, selection.geometry ? donor.geometry : target.geometry);
	assert.deepEqual(result.masks, selection.localAdjustments ? donor.masks : target.masks);
	assert.deepEqual(repairs(result), selection.repairs ? repairs(donor) : repairs(target));
	const retained = target.effects.filter(effect => !selectedEffect(target, selection, effect));
	const donated = donor.effects.filter(effect => selectedEffect(donor, selection, effect));
	const position = target.effects.findIndex(effect => selectedEffect(target, selection, effect));
	const insertion = position < 0 ? retained.length : position;
	assert.deepEqual(result.effects.map(semantic), [...retained.slice(0, insertion), ...donated, ...retained.slice(insertion)].map(semantic));
	for (const effect of retained) assert.deepEqual(result.effects.find(value => value.id === effect.id), effect);
	assert.equal(new Set(result.effects.map(effect => effect.id)).size, result.effects.length);
	assert.equal(new Set(result.masks.map(mask => mask.id)).size, result.masks.length);
	for (const binding of result.maskBindings) {
		assert.ok(result.effects.some(effect => effect.id === binding.effectId)); assert.ok(result.masks.some(mask => mask.id === binding.maskId));
	}
}

test('seed2026102703 generated Packet4 presets preserve explicit RAW selection independently of mixed-process settings', () => {
	fc.assert(fc.property(rawPropertySpec, rawPropertySpec, selections, fc.constantFrom(1, 2, 3, 4), (source, destination, selection, process) => {
		const donor = rawPropertyRecipe(source), target = rawPropertyRecipe(destination, undefined, process as 1 | 2 | 3 | 4);
		const original = JSON.stringify([donor, target]), packet = copyImageDevelopSettingsV4({ schemaVersion: 4, develop: donor, selection });
		assert.equal(packet.schemaVersion, 4); assert.equal(packet.develop.processVersion, 4);
		assert.equal(mode(packet.develop), selection.rawDevelopment ? source.mode : 'canonical');
		const preset = createImageDevelopPresetV4({ schemaVersion: 4, id: 'generated-raw', name: source.values.name, settings: packet });
		const wire = serializeImageDevelopPresetV4(preset), reopened = parseImageDevelopPresetV4(wire);
		assert.deepEqual(reopened, preset); assert.equal(serializeImageDevelopPresetV4(reopened), wire);
		const result = mergeImageDevelopSettingsV4({ schemaVersion: 4, target, settings: reopened.settings });
		assertDonation(donor, target, selection, result);
		assert.deepEqual(mergeImageDevelopSettingsV4({ schemaVersion: 4, target: result, settings: reopened.settings }), result);
		assert.equal(JSON.stringify([donor, target]), original);
		for (const mutation of [{ ...preset, schemaVersion: 5 }, { ...preset, body: new Uint8Array(1) },
			{ ...preset, settings: { ...packet, develop: { ...packet.develop, rawDevelopment: { schemaVersion: 1, mode: 'invented' } } } }]) {
			assert.throws(() => parseImageDevelopPresetV4(JSON.stringify(mutation)));
		}
	}), { seed: 2026102703, numRuns: 48, endOnFailure: true });
});

test('seed2026102704 actual RAW Current4 native presets and Archive8 retain generated inactive history and complete body closure', { timeout: 180_000 }, async context => {
	const fixed: RawPropertySpec = { mode: 'canonical', values: { exposure: 8, temperature: 12, saturation: -10, target: 6, source: 2,
		radius: 1, feather: 2, opacity: 4, mode: 'clone', enabled: true, flip: false, rotation: 90, operation: 'subtract', inverted: false, name: 'RAW é' } };
	const examples: [RawPropertySpec, RawPropertySpec, ImageDevelopSelectionV4, 1 | 2 | 3 | 4][] = RAW_PROPERTY_MODES.map((mode, index) =>
		[{ ...fixed, mode }, { ...fixed, mode: mode === 'headroom' ? 'recovery' : 'headroom' },
			{ effectTypes: ['tone-ladder-v1'], geometry: true, localAdjustments: index !== 0, repairs: index === 2, rawDevelopment: index !== 1 }, ([1, 3, 4] as const)[index]!]);
	const visited = { cases: 0, sourceModes: { canonical: 0, headroom: 0, recovery: 0 }, selectedRaw: 0, retainedRaw: 0, targetProcesses: new Set<number>(), joined: 0 };
	await fc.assert(fc.asyncProperty(rawPropertySpec, rawPropertySpec, selections, fc.constantFrom(1, 2, 3, 4), async (source, destination, selection, process) => {
		const f = await rawDevelopPropertiesFixture();
		const restore = createPhotoLibraryRestoreRuntimeCurrentV1({ name: 'Generated RAW archive', indexedDB: f.native.factory, locks: f.options.locks });
		try {
			const targetIndex = await f.addRaw(), donor = rawPropertyRecipe(source, f.resources);
			const target = rawPropertyRecipe(destination, f.resources, process as 1 | 2 | 3 | 4);
			await f.record(donor); await f.record(target, targetIndex);
			const custody = await f.custody(), settings = f.session.develop.settingsCurrent, presets = f.session.develop.presetsCurrent;
			assert.ok(settings); assert.ok(presets); const savedSource = await f.read();
			const packet = await settings.copySelected({ schemaVersion: 3, catalogId: savedSource.catalogId, photoId: savedSource.photoId,
				versionId: savedSource.versionId, revision: savedSource.revision, develop: donor, selection });
			assert.equal(packet.schemaVersion, 4); assert.equal(mode(packet.develop), selection.rawDevelopment ? source.mode : 'canonical');
			const preset = presets.create({ schemaVersion: 3, id: 'generated-native-raw', name: source.values.name, settings: packet });
			assert.equal(preset.schemaVersion, 4);
			const ack = await presets.write({ schemaVersion: 3, catalogId: savedSource.catalogId, command: { type: 'save', expectedRevision: 0, preset } });
			assert.equal(ack.snapshot.revision, 1); const row = await f.row(); assert.ok(row); assert.equal(row.schemaVersion, 4);
			assert.throws(() => normalizePhotoDevelopPresetRowV3(row, savedSource.catalogId));
			await f.reopen(); const selectedSettings = f.session.develop.settingsCurrent, selectedPresets = f.session.develop.presetsCurrent;
			assert.ok(selectedSettings); assert.ok(selectedPresets);
			assert.deepEqual((await selectedPresets.read({ schemaVersion: 3, catalogId: savedSource.catalogId, presetId: preset.identity.id, expectedRevision: 1 })).preset, preset);
			const before = await f.read(targetIndex), batch = { schemaVersion: 3 as const, catalogId: before.catalogId,
				targets: [{ photoId: before.photoId, versionId: before.versionId, expectedRevision: before.revision }],
				action: { kind: 'preset' as const, presetId: preset.identity.id, expectedPresetRevision: 1 }, label: 'Generated RAW donation', createdAt: RAW_PROPERTY_TIME };
			const applied = await selectedSettings.applyBatch(batch); assert.equal(applied.completion, 'finished'); assert.deepEqual(applied.notices, []);
			const result = await f.read(targetIndex); assertDonation(donor, target, selection, result.develop);
			const repeated = await selectedSettings.applyBatch({ ...batch, targets: [{ ...batch.targets[0]!, expectedRevision: result.revision }] });
			assert.equal(repeated.outcomes[0]!.status, 'unchanged'); assert.equal((await f.read(targetIndex)).revision, result.revision);
			await f.apply({ type: 'save-develop-snapshot', id: 'retained-raw', name: 'Retained RAW', createdAt: RAW_PROPERTY_TIME });
			await f.apply({ type: 'select-develop-history', cursor: 0 });
			const inactive = await f.photo(); assert.equal(inactive.versions[0]!.develop.processVersion, 1);
			assert.ok(inactive.versions[0]!.workspace!.entries.some(entry => entry.develop.processVersion === 4));
			assert.deepEqual(inactive.versions[0]!.workspace!.snapshots[0]!.develop, donor);
			const photos = await Promise.all(f.ids.map((_id, index) => f.photo(index))), count = (await f.session.readPage()).totalCount;
			const backup = await f.session.backupCatalog(); assert.ok(backup.blob);
			const archive = await readRepairBackupArchive(backup.blob); assert.equal(archive.document.schemaVersion, 8);
			const pack = archive.document.developPresetPack as { entry: string; rowSchemaVersion: number };
			assert.equal(pack.rowSchemaVersion, 4); const encoded = archive.entries.get(pack.entry); assert.ok(encoded);
			assert.deepEqual(JSON.parse(new TextDecoder().decode(encoded)) as unknown, row);
			assert.equal((archive.document.maskRasters as readonly unknown[]).length, 2);
			assert.equal((archive.document.lutResources as readonly unknown[]).length, 1);
			assert.deepEqual(await f.custody(), custody);
			await f.session.close(); const restored = await restore.restoreArchive(backup.blob); assert.equal(restored.photoCount, count);
			await f.reopen(); assert.equal((await f.session.readPage()).totalCount, count);
			assert.deepEqual(await Promise.all(f.ids.map((_id, index) => f.photo(index))), photos);
			assert.deepEqual(await f.row(), row); assert.deepEqual(await f.custody(), custody);
			const beforeRefusal = await f.row();
			assert.ok(preset.schemaVersion === 4); assert.ok(packet.schemaVersion === 4); assert.ok(packet.develop.processVersion === 4);
			const mismatched: ImageDevelopPresetV4 = { ...preset, settings: { ...packet,
				develop: { ...packet.develop, rawDevelopment: { schemaVersion: 1, mode: packet.develop.rawDevelopment.mode === 'headroom' ? 'recovery' : 'headroom' } } } };
			const current = f.session.develop.presetsCurrent; assert.ok(current);
			await assert.rejects(current.write({ schemaVersion: 3, catalogId: savedSource.catalogId, command: { type: 'save', expectedRevision: 1, preset: mismatched } }));
			assert.deepEqual(await f.row(), beforeRefusal); assert.deepEqual(await f.custody(), custody);
			assert.deepEqual(f.workerCounts(), { canonical: 0, recovery: 0 });
			visited.cases++; visited.sourceModes[source.mode]++; visited.targetProcesses.add(process);
			if (selection.rawDevelopment) visited.selectedRaw++; else visited.retainedRaw++;
		} finally { try { await restore.close(); } finally { await f.close(); assert.deepEqual(f.workerCounts(), { canonical: 0, recovery: 0 }); visited.joined++; } }
	}), { seed: 2026102704, numRuns: 6, examples, endOnFailure: true, includeErrorInReport: true });
	assert.equal(visited.cases, 6); assert.equal(visited.joined, 6);
	for (const mode of RAW_PROPERTY_MODES) assert.ok(visited.sourceModes[mode] > 0);
	assert.ok(visited.selectedRaw > 0 && visited.retainedRaw > 0);
	assert.deepEqual([...visited.targetProcesses].sort(), [1, 2, 3, 4]);
	context.diagnostic(JSON.stringify({ kind: 'current4-preset-archive-property-coverage', seed: 2026102704,
		...visited, targetProcesses: [...visited.targetProcesses].sort() }));
});
