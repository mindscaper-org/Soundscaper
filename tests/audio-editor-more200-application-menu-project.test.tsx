/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorMenuBar from '../src/common/editor/ui/AudioEditorMenuBar.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const changed of [true, false]) test(`materialized menu ${changed ? 'retires on activation' : 'survives ordinary project updates'}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const render = async (session: string) => {
		await act(async () => { root.render(<AudioEditorMenuBar appName="Soundscaper" copy={ENGLISH_COPY}
			locale="en" menus={[{ id: 'tracks', label: 'Tracks', items: [{ id: 'duplicate', label: 'Duplicate track', onClick() {} }] }]}
			onAssistanceSearchClose={() => undefined} onFullscreen={() => undefined} onSearchActivate={() => undefined}
			projectSessionKey={session} projectTabs={null} projectName="Programme" saveState="saved" saveText="Saved" />); });
	};
	try {
		await render('project-A:1');
		const trigger = dom.one('[role="menuitem"]');
		await act(async () => { reactProps(trigger).onClick?.({}); });
		assert.equal(trigger.getAttribute('aria-expanded'), 'true');
		await render(changed ? 'project-A:2' : 'project-A:1');
		assert.equal(trigger.getAttribute('aria-expanded'), String(!changed));
	} finally {
		await act(async () => { root.unmount(); });
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});
