/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import type { ScapeArchiveByteSource } from '../src/common/scape/archive-byte-source.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const title of ['Ordinary programme', 'Ordinary programme '.repeat(9) + 'Mixdown', '東京での録音'.repeat(20)]) {
	test(`the native suggested name preserves the project suffix for a ${title.length} character title`, async (context) => {
		const store = createProjectStore({ indexedDB: null, databaseName: `save-suffix-${crypto.randomUUID()}` });
		context.after(async () => { await store.close(); });
		const project = createFramescaperProject(undefined, { title });
		const exported = await exportScapeProject(project, store);
		const blob = exported.blob;
		assert.ok(blob);
		const native = await nativeSidecarFixture('ordinary.srt', '', { saveName: 'choice.fscape', saveSuggestedName: true, openSavedFile: true });
		context.after(native.close);
		const service = createAudioEditorFileService({ bridge: native.bridge, fetch: native.fetch });
		const saved = await service.saveFile({ purpose: 'project', suggestedName: `${title}.fscape`, blob });
		assert.deepEqual(await native.savedBytes(), Buffer.from(await blob.arrayBuffer()));
		const files = await service.chooseFiles({ purpose: 'project', multiple: false });
		assert.equal(files.length, 1, 'the actual saved file must remain selectable in native Open');
		assert.ok(saved.fileName.endsWith('.fscape'), 'retain the selected product file suffix');
		await service.withScapeReadDescriptor(files[0], {}, async (source: ScapeArchiveByteSource) => {
			assert.deepEqual(await source.read({ offset: 0, length: source.size }), new Uint8Array(await blob.arrayBuffer()));
			const profile = FRAMESCAPER_PROJECT_RUNTIME_PROFILE;
			const recipient = createFramescaperProjectStore(profile, { indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
			context.after(async () => { await recipient.close(); });
			const reopened = await createFramescaperScapeNativeRuntime(profile).importScapeProject(source, recipient);
			assert.equal(reopened.readOnly, false);
			const restored: unknown = reopened.project; assert.ok(validateFramescaperProject(profile, restored));
			assert.equal(restored.title, title); assert.equal(restored.id, project.id);
			assert.equal(restored.schemaFamily, 'framescaper'); assert.equal(restored.sources.length, 0);
		});
	});
}
