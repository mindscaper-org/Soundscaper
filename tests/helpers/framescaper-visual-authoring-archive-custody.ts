/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { currentReviewedVideoProject } from './reviewed-video-project-custody.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

type Store = ReturnType<typeof createFramescaperProjectStore>;

/** One fresh native archive recipient; every expected media byte is independent input, never rendered output. */
export async function reopenVisualAuthoringArchive(projectValue: unknown, store: Store,
	media: ReadonlyMap<string, Uint8Array> = new Map(), expectedValue: unknown = projectValue,
	restoredKeys: ReadonlyMap<string, string> = new Map()) {
	const project = currentReviewedVideoProject(projectValue), expected = currentReviewedVideoProject(expectedValue);
	const verifyMedia = async (repository: Pick<Store, 'loadMediaAsset'>, keys: ReadonlyMap<string, string> = new Map()) => {
		for (const [storageKey, bytes] of media) {
			const blob = await repository.loadMediaAsset(keys.get(storageKey) ?? storageKey); assert.ok(blob instanceof Blob);
			assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), Uint8Array.from(bytes));
		}
	};
	await verifyMedia(store);
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	const exported = await archive.exportScapeProject(project, store); assert.ok(exported.blob);
	const recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	try {
		const imported = await archive.importScapeProject(exported.blob, recipient);
		assert.equal(imported.readOnly, false);
		const reopened = currentReviewedVideoProject(imported.project);
		assert.deepEqual(reopened, expected, 'every authored field reaches the fresh native Scape recipient');
		assert.deepEqual(await recipient.loadProject(expected.id), expected);
		await verifyMedia(recipient, restoredKeys);
		return reopened;
	} finally { await recipient.close(); }
}
