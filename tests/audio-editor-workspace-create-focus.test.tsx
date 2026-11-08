/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import { createAudioEditorPreferencesV1, createCustomAudioEditorWorkspace } from '../src/common/editor/preferences.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const moved of [false, true]) test(`workspace creation completion respects later focus=${moved}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let finish: () => void = () => {};
	const pending = new Promise<void>(resolve => { finish = resolve; });
	let preferences = createAudioEditorPreferencesV1({});
	const controller = { actions: { preferences: { createWorkspace(name: string) {
		preferences = createCustomAudioEditorWorkspace(preferences, { id: 'review', name });
		return pending;
	} } } };
	const render = async () => { await act(async () => { root.render(<WorkspacePreferencesDialog controller={controller}
		snapshot={{ preferences }} copy={ENGLISH_COPY} locale="en" fileService={{ isDesktop: false }} menus={[]}
		run={(operation: () => unknown) => operation()} initialPage="workspace" onTogglePanel={() => undefined} onClose={() => undefined} />); }); };
	try {
		await render();
		const name = dom.one('[aria-label="Workspace name"]');
		await act(async () => { reactProps(name).onChange({ currentTarget: { value: 'Review' } }); });
		const create = dom.container.querySelectorAll('button').find(button => button.textContent === 'Create from current layout');
		assert.ok(create);
		create.focus();
		await act(async () => { reactProps(create).onClick({ currentTarget: create }); });
		await render();
		const later = dom.container.querySelectorAll('[role="tab"]').find(tab => tab.textContent.endsWith('Appearance'));
		assert.ok(later);
		if (moved) later.focus(); else dom.container.ownerDocument.body.focus();
		await act(async () => { finish(); await pending; });
		assert.equal(name.value, '');
		assert.equal(create.hasAttribute('disabled'), true);
		assert.equal(dom.container.ownerDocument.activeElement === (moved ? later : name), true);
	} finally {
		finish();
		await act(async () => { root.unmount(); });
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
