/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { ControllerOptions } from '../../src/common/editor/controller/composition/controller-options.ts';
import type { AudioEditorProjectStoreOptions } from '../../src/common/editor/storage/project-store-options.ts';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from '../../src/soundscaper/editor-project-playback.ts';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

type CompatibilityOptions = Pick<ControllerOptions, 'locale' | 'copy' | 'fileService' | 'prepareProjectSnapshot'>;
type CompatibilityStoreOptions = Omit<AudioEditorProjectStoreOptions, 'indexedDB'> & {
	readonly indexedDB: ReturnType<typeof createInstrumentedIndexedDB>;
};

/** Open the retained exact store and playback services used by the integration fixtures. */
export async function openSoundscaperCompatibilityFixture(options: CompatibilityStoreOptions) {
	const store = createSoundscaperProjectStore(options);
	try {
		await store.ready();
		assert.equal(store.getStatus()?.persistent, true, 'the compatibility fixture must use durable storage');
		const runtime = createSoundscaperProjectRuntimeSelection();
		const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store);
		return { store, runtime, playback, async close() {
			try { playback.dispose(); } finally { await store.close(); }
		} };
	} catch (error) {
		await store.close();
		throw error;
	}
}

/** Mount the shared controller over the retained family-v1 storage for compatibility tests. */
export function createSoundscaperCompatibilityController(
	fixture: Awaited<ReturnType<typeof openSoundscaperCompatibilityFixture>>,
	options: CompatibilityOptions = {},
) {
	return createAudioEditorController(null, {
		headless: true,
		productId: 'soundscaper',
		store: fixture.store,
		projectRuntime: fixture.runtime,
		sessionController: fixture.runtime.createSessionController(),
		acquireProjectLock: fixture.runtime.acquireProjectLock,
		playbackProjectService: fixture.playback,
		createProjectIfAbsent: fixture.store.createProjectIfAbsent.bind(fixture.store),
		...options,
	});
}

/** A real product controller and store; callers supply only the platform ports. */
export async function controllerSession(context: TestContext, overrides: Partial<Options> = {}) {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'], ...overrides });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	return { controller, store };
}
