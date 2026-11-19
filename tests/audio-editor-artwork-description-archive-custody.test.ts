/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createId3Artwork, decodeArtworkData, parseId3Artwork, suggestId3ArtworkDescription } from '../src/common/editor/id3-artwork.ts';
import { id3ProjectFieldValue, updateId3ProjectField } from '../src/common/editor/id3-descriptive-fields.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { assertEditedAudioArchiveCustody } from './helpers/edited-audio-archive-custody.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=', 'base64'));

for (const [fileName, expected] of [['cover.png', 'cover.png'], ['cover\nimage.png', 'cover image.png']] as const) {
	test(`artwork filename ${JSON.stringify(fileName)} retains independent unique descriptions and bytes through controller history and Scape`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'],
			engineFactory: () => { throw new Error('Artwork metadata custody must not invoke a substitute renderer.'); } });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		for (let index = 0; index < 2; index++) {
			const current: unknown = controller.project; assert.ok(validateSoundscaperProject(current));
			const existing = parseId3Artwork(id3ProjectFieldValue(current.metadata, 'id3Artwork'));
			const picture = await createId3Artwork(new File([PNG], fileName, { type: 'image/png' }));
			const artwork = parseId3Artwork([...existing, { ...picture, description: suggestId3ArtworkDescription(picture.description, existing) }]);
			controller.actions.metadata.update(updateId3ProjectField(current.metadata, 'id3Artwork', JSON.stringify(artwork)));
		}
		const authored: unknown = controller.project; assert.ok(validateSoundscaperProject(authored));
		const artworks = parseId3Artwork(id3ProjectFieldValue(authored.metadata, 'id3Artwork'));
		assert.deepEqual(artworks.map(item => item.description), [expected, `${expected} (2)`]);
		controller.actions.edit.undo();
		const undone: unknown = controller.project; assert.ok(validateSoundscaperProject(undone));
		assert.equal(parseId3Artwork(id3ProjectFieldValue(undone.metadata, 'id3Artwork')).length, 1);
		controller.actions.edit.redo(); await controller.actions.project.flush();
		const reopened = await assertEditedAudioArchiveCustody(context, store, controller.project, []);
		const retained = parseId3Artwork(id3ProjectFieldValue(reopened.metadata, 'id3Artwork'));
		assert.deepEqual(retained.map(item => item.description), [expected, `${expected} (2)`]);
		for (const item of retained) { assert.equal(item.mimeType, 'image/png'); assert.equal(item.pictureType, 3); assert.deepEqual(decodeArtworkData(item.data), PNG); }
	});
}
