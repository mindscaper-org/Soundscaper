/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAudacityActionHandler } from '../src/common/editor/audacity-action-parity.js';
import { AUDACITY_SHORTCUT_IMPORT_MAX_BYTES, parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';
import { createShortcutImportSession, type ShortcutImportSource } from '../src/common/editor/controller/preferences/shortcut-import-session.ts';
import { loadAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const version of [3, 4]) test(`Audacity ${version} file bindings reopen durably and reach the real track action`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const indexedDB = createInstrumentedIndexedDB();
	const createStore = () => createSoundscaperProjectStore({ indexedDB, preferOpfs: false });
	const controller = await open();
	await controller.actions.preferences.update({ shortcuts: { 'new-mono-track': ['Ctrl+Shift+N'], 'new-label-track': ['Alt+L'] } });
	const before = structuredClone(shortcutsFrom(controller));
	const bindings = version === 3 ? ['Ctrl+Alt+Shift+F6'] : ['Ctrl+Alt+Shift+F8', 'Ctrl+Alt+Shift+F9'];
	const unavailable = version === 3 ? 'FutureAudacityCommand' : 'future-audacity-command';
	const xml = version === 3 ? `<audacitykeyboard audacityversion="3.7.7"><command name="NewMonoTrack" key="${bindings[0]}"/><command name="${unavailable}" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>`
		: `<Shortcuts><SC><key>new-mono-track</key>${bindings.map(binding => `<seq>${binding}</seq>`).join('')}</SC><SC><key>${unavailable}</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>`;
	const state: { source: ShortcutImportSource | null } = { source: null };
	const session = createShortcutImportSession({
		loadImporter: async () => ({ AUDACITY_SHORTCUT_IMPORT_MAX_BYTES, parseAudacityShortcutImport }),
		saveShortcuts: async shortcuts => { await controller.actions.preferences.update({ shortcuts }); },
		onSource: source => { state.source = source; }, onBusy: () => undefined,
		onReadError: error => { assert.equal(error, null); }, onImported: () => undefined,
	});
	context.after(() => { session.dispose(); });
	await session.read(new File([xml], `Audacity ${version}.xml`, { type: 'application/xml' }));
	assert.ok(state.source);
	const plan = state.source.parse(state.source.xml, before);
	assert.equal(plan.importedCount, 1);
	assert.deepEqual(plan.skipped, [{ command: unavailable, reason: 'unsupported-command' }]);
	assert.deepEqual(shortcutsFrom(controller), before, 'review cannot apply the file early');
	await session.apply(plan);
	await controller.dispose();
	const reopened = await open();
	const shortcuts = shortcutsFrom(reopened);
	assert.deepEqual(shortcuts['new-mono-track'], bindings);
	assert.deepEqual(shortcuts['new-label-track'], ['Alt+L']);
	const initial = reopened.project!.tracks.length;
	for (const [index, binding] of bindings.entries()) {
		const action = Object.keys(shortcuts).find(id => shortcuts[id]?.includes(binding));
		assert.ok(action === 'new-mono-track');
		const handler = resolveAudacityActionHandler(action, reopened.actions); assert.ok(handler);
		await handler();
		assert.equal(reopened.project!.tracks.length, initial + index + 1);
		const track = reopened.project!.tracks.at(-1); assert.ok(track?.type === 'audio');
		assert.deepEqual(track.clipIds, []);
	}

	async function open() {
		const runtime = createSoundscaperProjectRuntimeSelection();
		const value = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store: createStore(),
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await value.dispose(); });
		await value.ready;
		return value;
	}
});

function shortcutsFrom(controller: ReturnType<typeof createAudioEditorController>) {
	const loaded = loadAudioEditorPreferencesV1(controller.getSnapshot().preferences);
	assert.equal(loaded.readOnly, false);
	return loaded.preferences.shortcuts;
}
