/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createDeliveryPresetState } from '../src/common/editor/delivery-preset-store.ts';
import { DELIVERY_PRESETS_SETTING_KEY as key } from '../src/common/editor/controller/export/delivery-preset-service.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
const preset = (label: string) => ({ label, kind: 'audio' as const, format: 'wav', settings: { channelMapping: 'stereo' } });
async function editors(context: TestContext, seeded = false) {
	const stores = [0, 1].map(() => createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }));
	const create = (store: (typeof stores)[number]) => createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	const first = create(stores[0]!); await first.ready;
	const initial = seeded ? await first.actions.export.presets.save(preset('Original')) : null;
	const second = create(stores[1]!); await second.ready;
	context.after(async () => { await first.dispose(); await second.dispose(); });
	return { first: first.actions.export.presets, second: second.actions.export.presets, stores, initial,
		labels: async () => createDeliveryPresetState(await stores[0]!.loadSetting(key)).presets.map(row => row.label).sort() };
}

test('saving delivery presets in two open editors preserves both durable library edits', async context => {
	const { first, second, stores, labels } = await editors(context);
	const radio = await first.save({ ...preset('Radio mono'), settings: { channelMapping: 'mono' } });
	const archive = await second.save(preset('Archive stereo'));
	const durable = createDeliveryPresetState(await stores[0]!.loadSetting(key));
	assert.deepEqual(durable.presets.map(row => [row.id, row.settings.channelMapping]), [[radio.id, 'mono'], [archive.id, 'stereo']]);
	assert.deepEqual(await labels(), ['Archive stereo', 'Radio mono']);
});

test('simultaneous Save as operations retry their collection conflict without losing either preset', async context => {
	const { first, second, labels } = await editors(context);
	await Promise.all([first.save(preset('Radio mono')), second.save(preset('Archive stereo'))]);
	assert.deepEqual(await labels(), ['Archive stereo', 'Radio mono']);
});

test('a stale tab saving a new preset cannot resurrect a remotely deleted preset', async context => {
	const { first, second, labels, initial } = await editors(context, true); assert.ok(initial);
	await first.delete(initial.id); await second.save(preset('New delivery'));
	assert.deepEqual(await labels(), ['New delivery']);
});

test('a stale explicit overwrite of a remotely deleted preset refuses without recreating it', async context => {
	const { first, second, labels, initial } = await editors(context, true); assert.ok(initial);
	await first.delete(initial.id);
	await assert.rejects(second.save({ ...preset('Updated'), id: initial.id }), /does not exist/u);
	assert.deepEqual(await labels(), []);
});

test('deleting a preset preserves unrelated presets saved by another tab', async context => {
	const { first, second, labels, initial } = await editors(context, true); assert.ok(initial);
	await first.save(preset('New delivery')); await second.delete(initial.id);
	assert.deepEqual(await labels(), ['New delivery']);
});

test('an intentional same-ID overwrite retains identity and remote unrelated presets', async context => {
	const { first, second, labels, initial } = await editors(context, true); assert.ok(initial);
	await first.save(preset('New delivery'));
	const updated = await second.save({ ...preset('Updated'), id: initial.id });
	assert.equal(updated.id, initial.id); assert.equal(updated.createdAt, initial.createdAt);
	assert.deepEqual(await labels(), ['New delivery', 'Updated']);
});

test('importing a preset file merges into the latest durable collection', async context => {
	const { first, second, labels, initial } = await editors(context, true); assert.ok(initial);
	const exported = first.export(initial.id); await first.save(preset('New delivery'));
	await second.import(exported);
	assert.deepEqual(await labels(), ['New delivery', 'Original']);
});

for (const seeded of [false, true]) test(`required collection ${seeded ? 'replacement' : 'creation'} errors preserve durable and local libraries and permit retry`, async context => {
	const { second, stores, labels } = await editors(context, seeded);
	const store = stores[1]!, repository = store.settingsRepository;
	const save = store.saveSetting.bind(store), put = repository.putIfAbsent.bind(repository), replace = repository.replaceIfCurrent.bind(repository);
	const before = second.list();
	const failure = new Error('Preset storage unavailable');
	store.saveSetting = async (id, value) => { if (id === key) throw failure; return await save(id, value); };
	repository.putIfAbsent = async (id, value) => { if (id === key) throw failure; return await put(id, value); };
	repository.replaceIfCurrent = async (id, expected, value) => { if (id === key) throw failure; return await replace(id, expected, value); };
	await assert.rejects(second.save(preset('Retry delivery')), error => error === failure);
	assert.deepEqual(second.list(), before); assert.deepEqual(await labels(), seeded ? ['Original'] : []);
	store.saveSetting = save; repository.putIfAbsent = put; repository.replaceIfCurrent = replace;
	await second.save(preset('Retry delivery'));
	assert.deepEqual(await labels(), seeded ? ['Original', 'Retry delivery'] : ['Retry delivery']);
});


test('simultaneous deletion and Save as resolve without resurrecting the deleted preset', async context => {
	const { first, second, labels, initial } = await editors(context, true); assert.ok(initial);
	await Promise.all([first.delete(initial.id), second.save(preset('New delivery'))]);
	assert.deepEqual(await labels(), ['New delivery']);
});

test('continued collection contention refuses with unchanged state and permits a fresh retry', async context => {
	const { second, stores, labels } = await editors(context);
	const repository = stores[1]!.settingsRepository, put = repository.putIfAbsent.bind(repository);
	let attempts = 0;
	repository.putIfAbsent = async () => { attempts += 1; return false; };
	await assert.rejects(second.save(preset('Contended')), /changed in another editor/u);
	assert.ok(attempts > 1 && attempts <= 16); assert.deepEqual(await labels(), []); assert.deepEqual(second.list(), []);
	repository.putIfAbsent = put;
	await second.save(preset('Retry delivery')); assert.deepEqual(await labels(), ['Retry delivery']);
});
