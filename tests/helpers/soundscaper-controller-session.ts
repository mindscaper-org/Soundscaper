/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TestContext } from 'node:test';
import type { ControllerOptions } from '../../src/common/editor/controller/composition/controller-options.ts';
import type { SoundscaperEditorProjectEnvironment } from '../../src/soundscaper/editor-project-environment.ts';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

type CompatibilityOptions = Pick<ControllerOptions, 'locale' | 'copy' | 'fileService' | 'prepareProjectSnapshot'>;

/** Mount the shared controller over the retained family-v1 storage for compatibility tests. */
export function createSoundscaperCompatibilityController(
	environment: Readonly<SoundscaperEditorProjectEnvironment>,
	options: CompatibilityOptions = {},
) {
	return createAudioEditorController(null, {
		headless: true,
		productId: 'soundscaper',
		store: environment.store,
		projectRuntime: environment.runtime,
		sessionController: environment.runtime.createSessionController(),
		acquireProjectLock: environment.runtime.acquireProjectLock,
		playbackProjectService: environment.playback,
		createProjectIfAbsent: environment.createProjectIfAbsent,
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
