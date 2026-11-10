/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorMacroManagerDialog from '../src/common/editor/ui/inspector/AudioEditorMacroManagerDialog.jsx';
import { EFFECT_MACRO_LIBRARY_SETTING_KEY, type EffectMacroLibraryEntry } from '../src/common/editor/controller/effects/effect-macro-library-service.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

type Controller = ReturnType<typeof createAudioEditorController>;
type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

/** Only platform DOM ports are supplied; the import, controlled draft and library are production owners. */
function Palette({ controller }: Readonly<{ controller: Controller }>) {
	const [snapshot, setSnapshot] = useState(() => controller.getSnapshot());
	const [draft, setDraft] = useState<EffectMacroLibraryEntry | null>(() => controller.actions.macros.library.list()[0] ?? null);
	useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller]);
	return <AudioEditorMacroManagerDialog isOpen productId="soundscaper" controller={controller} snapshot={snapshot}
		copy={ENGLISH_COPY} locale="en" fileService={{}} draft={draft} onDraftChange={setDraft} onClose={() => undefined} />;
}

test('actual macro file import owns empty-stem names and fresh-controller global settings', async context => {
	const indexedDB = createInstrumentedIndexedDB();
	const createSession = async () => {
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createSoundscaperProjectStore({ indexedDB, preferOpfs: false });
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'],
			engineFactory: () => { throw new Error('Macro import names never render audio.'); } });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		return { controller, store };
	};
	const donor = await createSession();
	const initialProject = structuredClone(donor.controller.project);
	const initialHistory = structuredClone(donor.controller.getSnapshot().history);
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const render = async (controller: Controller, key: string) => {
		await act(async () => { root.render(<Palette key={key} controller={controller} />); });
	};
	const assertName = () => {
		const input = dom.one('[data-macro-name-input]').querySelector('input'); assert.ok(input);
		assert.equal(input.value, 'Untitled macro');
	};
	let imported: EffectMacroLibraryEntry | undefined;
	try {
		await render(donor.controller, 'donor');
		const library = donor.controller.actions.macros.library;
		for (const [index, filename] of ['.txt', '   .txt'].entries()) {
			const priorIds = new Set(library.list().map(macro => macro.id));
			const file = new File(['Invert:\n'], filename, { type: 'text/plain' });
			const input = { files: [file], value: filename };
			await act(async () => {
				reactProps(dom.one('[data-macro-import-file]')).onChange({ currentTarget: input });
				for (let turn = 0; turn < 20 && !library.list().some(macro => !priorIds.has(macro.id)); turn += 1)
					await new Promise<void>(resolve => setImmediate(resolve));
				await library.flush();
			});
			const entry = library.list().find(macro => !priorIds.has(macro.id)); assert.ok(entry);
			imported = entry;
			assertName();
			assert.equal(dom.container.querySelectorAll('[role="alert"]').length, 0);
			assert.equal(imported.name, 'Untitled macro');
			assert.equal(imported.effects.length, 1);
			assert.equal(imported.effects[0]?.type, 'audacity-invert');
			assert.equal(input.value, ''); assert.equal(file.name, filename); assert.equal(await file.text(), 'Invert:\n');
			const setting: unknown = await donor.store.loadSetting(EFFECT_MACRO_LIBRARY_SETTING_KEY);
			assert.ok(setting !== null && typeof setting === 'object');
			assert.deepEqual(Reflect.get(setting, 'macros'), library.list());
			assert.deepEqual(donor.controller.project, initialProject);
			assert.deepEqual(donor.controller.getSnapshot().history, initialHistory);
			if (index === 0) await act(async () => { library.delete(entry.id); await library.flush(); });
		}
		assert.ok(imported);
		const saved = structuredClone(library.list());
		await act(async () => { root.render(null); });
		await donor.controller.dispose();
		const recipient = await createSession();
		assert.deepEqual(recipient.controller.actions.macros.library.list(), saved);
		await render(recipient.controller, 'recipient');
		const button = dom.one('[data-macro-list]').querySelectorAll('button').find(node => node.textContent === 'Untitled macro'); assert.ok(button);
		await act(async () => { reactProps(button).onClick(); });
		assertName();
		assert.equal(recipient.controller.actions.macros.library.list().find(macro => macro.id === imported?.id)?.effects[0]?.type, 'audacity-invert');
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore(); globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
