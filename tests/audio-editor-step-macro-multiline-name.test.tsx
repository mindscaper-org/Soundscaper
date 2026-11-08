/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorMacroManagerDialog from '../src/common/editor/ui/inspector/AudioEditorMacroManagerDialog.jsx';
import { createInitialEffectMacroLibrary, createEffectMacroLibraryService } from '../src/common/editor/controller/effects/effect-macro-library-service.ts';
import { normalizeEffectMacroDraft } from '../src/common/editor/effect-macros.js';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the macro palette preserves valid multiline step names and keyed switching focus', async () => {
	const original = 'Opening\nRoom tone';
	const initial = createInitialEffectMacroLibrary({ schemaVersion: 1, defaultsInitialized: true,
		macros: ['first', 'second'].map((id, index) => normalizeEffectMacroDraft({ id, name: index ? 'Second macro' : original,
			effects: [createEffect('audacity-invert', { id: `invert-${id}` })] })) });
	const state = { effectMacros: initial };
	const library = createEffectMacroLibraryService({ state, createId: () => 'next', persistSetting: async () => undefined,
		publishDocumentSnapshot() {}, handleError(cause) { throw cause; } });
	const project = createSoundscaperProject({ id: 'macro-names' });
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const controller = { project, actions: { macros: { library, scripts: {} } } };
	function Fixture() {
		const [draft, setDraft] = useState(library.list()[0]!);
		return <AudioEditorMacroManagerDialog isOpen productId="soundscaper" controller={controller}
			snapshot={{ ready: true, project, macros: { library: library.list(), scripts: [] } }} copy={ENGLISH_COPY}
			locale="en" fileService={{}} draft={draft} onDraftChange={setDraft} onClose={() => undefined} />;
	}
	const nameField = () => {
		const label = dom.container.querySelectorAll('label').find(node => node.textContent === ENGLISH_COPY.macroName);
		assert.ok(label);
		return label.querySelector('input') ?? label.querySelector('textarea')!;
	};
	try {
		await act(async () => { root.render(<Fixture />); });
		const field = nameField();
		assert.equal(field.tagName, 'TEXTAREA');
		field.focus();
		for (const shiftKey of [true, false]) {
			let prevented = false;
			await act(async () => { reactProps(dom.one('[data-macro-name-input]')).onKeyDown?.({ key: 'Enter', shiftKey,
				nativeEvent: { isComposing: false }, preventDefault() { prevented = true; }, stopPropagation() {} }); });
			assert.equal(prevented, !shiftKey, 'only Shift+Enter inserts a native line break');
		}
		for (const name of [`${original}!`, 'Plain name']) {
			await act(async () => { reactProps(field).onChange?.({ target: { value: name } }); });
			assert.equal(library.list().find(macro => macro.id === 'first')?.name, name);
			assert.equal(nameField() === field, true);
			assert.equal(dom.container.ownerDocument.activeElement === field, true);
		}
		const second = dom.container.querySelectorAll('[data-macro-id]').find(node => node.getAttribute('data-macro-id') === 'second');
		assert.ok(second);
		second.focus();
		await act(async () => { reactProps(second).onClick?.({}); });
		assert.equal(nameField().tagName, 'INPUT');
		assert.equal(nameField().value, 'Second macro');
		assert.equal(dom.container.ownerDocument.activeElement === second, true);
	} finally {
		await library.flush();
		await act(async () => { root.unmount(); });
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
