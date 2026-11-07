/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createShortcutImportSession, type ShortcutImportSource } from '../../src/common/editor/controller/preferences/shortcut-import-session.ts';
import { AUDACITY_SHORTCUT_IMPORT_MAX_BYTES, parseAudacityShortcutImport } from '../../src/common/editor/audacity-shortcut-import.ts';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { loadAudioEditorPreferencesV1 } from '../../src/common/editor/preferences.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

/** Read and apply a real shortcut import session, then read its durable preferences. */
export async function importShortcutPreferences(context: TestContext, xml: string, current: Record<string, string[]>) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.preferences.update({ shortcuts: current });
	const before = structuredClone(loadAudioEditorPreferencesV1(controller.getSnapshot().preferences).preferences.shortcuts);
	const state: { source: ShortcutImportSource | null; saves: number } = { source: null, saves: 0 };
	const session = createShortcutImportSession({
		loadImporter: async () => ({ AUDACITY_SHORTCUT_IMPORT_MAX_BYTES, parseAudacityShortcutImport }),
		saveShortcuts: async shortcuts => { state.saves++; await controller.actions.preferences.update({ shortcuts }); },
		onSource: source => { state.source = source; }, onBusy: () => undefined,
		onReadError: error => { assert.equal(error, null); }, onImported: () => undefined,
	});
	try {
		await session.read(new File([xml], 'Shortcuts.xml', { type: 'application/xml' }));
		assert.ok(state.source);
		const plan = state.source.parse(state.source.xml, before);
		await session.apply(plan);
		const saved = await store.loadSetting('soundscaper:audio-editor-preferences-v1', null); assert.ok(saved);
		const persisted = loadAudioEditorPreferencesV1(saved); assert.equal(persisted.readOnly, false);
		assert.deepEqual(persisted.preferences.shortcuts, controller.getSnapshot().preferences.shortcuts);
		return { plan, before, persisted: persisted.preferences.shortcuts, saves: state.saves };
	} finally { session.dispose(); }
}
