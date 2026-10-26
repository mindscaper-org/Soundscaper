/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectMetadataPanel from '../src/common/editor/ui/workspace/ProjectMetadataPanel.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const tab of ['General', 'ID3']) test(`${tab} metadata preserves multiline tag drafts through native edits and Undo`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'multiline-metadata',
		metadata: { tags: { 'X-NOTES': 'First line\nSecond line' } } }));
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const beforeReact = globals.React, beforeAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	context.after(async () => { await act(async () => root.unmount()); dom.restore(); globals.React = beforeReact; globals.IS_REACT_ACT_ENVIRONMENT = beforeAct; });
	let pending: unknown;
	const render = async () => { await act(async () => root.render(<ProjectMetadataPanel controller={controller}
		project={controller.project} copy={ENGLISH_COPY} locale="en" disabled={false}
		onUpdate={changes => { pending = controller.actions.metadata.update(changes); }} />)); };
	await render();
	const button = Array.from(dom.container.querySelectorAll('button')).find(node => node.textContent === tab);
	assert.ok(button); await act(async () => reactProps(button).onClick?.());
	const field = Array.from(dom.container.querySelectorAll('input, textarea')).find(node =>
		String(reactProps(node).name) === `${tab === 'ID3' ? 'id3-custom-' : 'tag-'}X-NOTES`);
	assert.ok(field);
	assert.equal(field.tagName, 'TEXTAREA', 'the existing line break must remain editable as text');
	await act(async () => reactProps(field).onChange?.({ currentTarget: { value: 'First line\nSecond line!' } }));
	await act(async () => { reactProps(field).onBlur?.(); await pending; });
	assert.equal(controller.project?.metadata.tags['X-NOTES'], 'First line\nSecond line!');
	controller.actions.edit.undo(); await render();
	assert.equal(controller.project?.metadata.tags['X-NOTES'], 'First line\nSecond line');
	controller.actions.edit.redo(); await render();
	assert.equal(controller.project?.metadata.tags['X-NOTES'], 'First line\nSecond line!');
});
