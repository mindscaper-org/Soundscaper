/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createEffect } from '../src/common/editor/effects.js';
import { normalizeEffectMacroDraft } from '../src/common/editor/effect-macros.js';
import { createInitialEffectMacroLibrary, createEffectMacroLibraryService } from '../src/common/editor/controller/effects/effect-macro-library-service.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import AudioEditorMacroManagerDialog from '../src/common/editor/ui/inspector/AudioEditorMacroManagerDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('an actual full macro library retains its import refusal instead of announcing success', async () => {
	const initial = createInitialEffectMacroLibrary({ schemaVersion: 1, defaultsInitialized: true,
		macros: Array.from({ length: 256 }, (_, index) => normalizeEffectMacroDraft({ id: `saved-${index}`,
			name: `Saved ${index}`, effects: [createEffect('audacity-invert', { id: `invert-${index}` })] })) });
	const state = { effectMacros: initial };
	const library = createEffectMacroLibraryService({ state, createId: () => 'imported', persistSetting: async () => undefined,
		publishDocumentSnapshot() {}, handleError(cause) { throw cause; } });
	const project = createSoundscaperProject({ id: 'full-library' });
	const dom = installReactTestDom();
	Object.assign(globalThis.window, { getComputedStyle: () => ({ display: '', visibility: '' }) });
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AudioEditorMacroManagerDialog isOpen productId="soundscaper"
			controller={{ project, actions: { macros: { library, scripts: {} } } }}
			snapshot={{ ready: true, project, macros: { library: library.list(), scripts: [] } }}
			copy={ENGLISH_COPY} locale="en" fileService={{}} draft={library.list()[0]}
			onDraftChange={() => undefined} onClose={() => undefined} />));
		const input = dom.one('[data-macro-import-file]');
		const file = new File(['Invert:\n'], 'One more.txt');
		await act(async () => {
			reactProps(input).onChange({ currentTarget: { files: [file], value: file.name } });
			await new Promise<void>(resolve => setImmediate(resolve));
		});
		assert.equal(state.effectMacros, initial);
		assert.equal(library.list().length, 256);
		const message = dom.one('.audio-editor-macros-palette__message');
		assert.equal(message.getAttribute('role'), 'alert');
		assert.match(message.textContent, /library is full/iu);
	} finally {
		await library.flush(); await act(async () => root.unmount()); dom.restore();
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
	}
});
