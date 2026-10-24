/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createDeliveryPresetState } from '../src/common/editor/delivery-preset-store.ts';
import { DELIVERY_PRESETS_SETTING_KEY as key } from '../src/common/editor/controller/export/delivery-preset-service.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
const record = (id: string, label: string, channelMapping = 'stereo') => ({ schemaVersion: 1, id, label, kind: 'audio', format: 'wav', settings: { channelMapping } });
async function fixture(context: TestContext, id = ' radio ') {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const presets = controller.actions.export.presets;
	await presets.import(JSON.stringify({ schemaVersion: 1, presets: [record('radio', 'Archive stereo'), record(id, 'Radio mono', 'mono')] }));
	return { presets, id, durable: async () => createDeliveryPresetState(await store.loadSetting(key)) };
}
for (const id of [' radio ', '\u3000radio\u3000', ' ']) test(`Import preset retains the exact validated identity ${JSON.stringify(id)} when applying and exporting`, async context => {
	const { presets, durable } = await fixture(context, id);
	assert.equal(presets.apply(id).label, 'Radio mono'); assert.equal(presets.apply(id).settings.channelMapping, 'mono');
	assert.equal(presets.apply('radio').label, 'Archive stereo');
	const exported = createDeliveryPresetState(JSON.parse(presets.export(id)));
	assert.equal(exported.presets[0]?.id, id); assert.equal(exported.presets[0]?.label, 'Radio mono');
	assert.deepEqual((await durable()).presets.map(row => row.id), ['radio', id]);
});
test('Save of an imported preset overwrites only its exact identity', async context => {
	const { presets, id, durable } = await fixture(context);
	const saved = await presets.save({ id, label: 'Updated radio', kind: 'audio', format: 'wav', settings: { channelMapping: 'mono' } });
	assert.equal(saved.id, id); assert.equal(presets.apply('radio').label, 'Archive stereo');
	assert.deepEqual((await durable()).presets.map(row => [row.id, row.label]), [['radio', 'Archive stereo'], [id, 'Updated radio']]);
});
test('Delete of an imported preset removes only its exact identity', async context => {
	const { presets, id, durable } = await fixture(context); await presets.delete(id);
	assert.deepEqual((await durable()).presets.map(row => row.id), ['radio']); assert.equal(presets.apply('radio').label, 'Archive stereo');
});
test('empty and missing preset identities still refuse without changing durable records', async context => {
	const { presets, durable } = await fixture(context);
	const before = await durable();
	for (const id of ['', 'missing', '  missing  ']) {
		assert.throws(() => presets.apply(id)); assert.throws(() => presets.export(id));
		await assert.rejects(presets.delete(id));
	}
	await assert.rejects(presets.save({ id: 'missing', label: 'No record', kind: 'audio', format: 'wav' }), /does not exist/u);
	assert.deepEqual(await durable(), before);
});
