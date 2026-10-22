/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackListView } from '../src/common/editor/ui/timeline/TrackListView.jsx';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document/document-track-folder-snapshot.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('NP028: read-only folder inspection is local, respects busy ownership and retires on activation', async context => {
	const project = createSoundscaperProject({ id: 'folders', title: 'Folders', primarySequenceId: 'main',
		trackFolders: [{ id: 'outer', name: 'Outer', collapsed: true }, { id: 'inner', name: 'Inner' }],
		sequences: [{ id: 'main', trackNodes: [{ kind: 'folder', id: 'outer', parentFolderId: null },
			{ kind: 'folder', id: 'inner', parentFolderId: 'outer' }] }] });
	const original = JSON.stringify(project), edits: unknown[] = [];
	let generation = 1;
	const noop = () => undefined;
	const controller = { captureProjectGeneration: () => ({ projectId: project.id, generation }), actions: { trackFolders: {
		select: noop, toggleCollapsed: (...args: unknown[]) => { edits.push(args); }, update: noop, rename: noop, moveNode: noop,
	} } };
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const oldReact = globals.React, oldAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	context.after(async () => { await act(async () => root.unmount()); dom.restore(); globals.React = oldReact; globals.IS_REACT_ACT_ENVIRONMENT = oldAct; });
	const Component = TrackListView as unknown as React.ComponentType<Record<string, unknown>>;
	const render = async (readOnly = true, importing = false) => { await act(async () => root.render(<Component project={project} controller={controller}
		snapshot={{ project, readOnly, importing, trackFolders: createDocumentTrackFolderSnapshot(project), preferences: {} }}
		locale="en" copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()} visualTrackHeight={() => 80}
		mutationsBlocked={true} panelWidth={180} setTrackMenu={noop} />)); };
	const chevron = () => dom.one('.audio-editor-track-folder-row__chevron');
	await render();
	assert.equal(reactProps(chevron()).disabled, false, 'read-only folders remain inspectable');
	await act(async () => reactProps(chevron()).onClick?.({ stopPropagation: noop }));
	assert.equal(dom.container.querySelectorAll('[data-track-folder-row]').length, 2);
	assert.equal(dom.one('[data-track-folder-row]').getAttribute('aria-expanded'), 'true');
	assert.equal(reactProps(dom.one('.audio-editor-track-folder-row__toggle')).disabled, true);
	assert.deepEqual(edits, []); assert.equal(JSON.stringify(project), original);
	await render(true, true);
	assert.equal(reactProps(chevron()).disabled, true, 'busy read-only views still block the action');
	await render();
	await act(async () => reactProps(dom.one('[data-track-folder-row]')).onKeyDown?.({ key: 'ArrowLeft', preventDefault: noop, stopPropagation: noop }));
	assert.equal(dom.container.querySelectorAll('[data-track-folder-row]').length, 1);
	await act(async () => reactProps(dom.one('[data-track-folder-row]')).onKeyDown?.({ key: 'ArrowRight', preventDefault: noop, stopPropagation: noop }));
	assert.equal(dom.container.querySelectorAll('[data-track-folder-row]').length, 2);
	generation += 1; await render();
	assert.equal(dom.container.querySelectorAll('[data-track-folder-row]').length, 1, 'activation retires local expansion');
	await act(async () => reactProps(chevron()).onClick?.({ stopPropagation: noop }));
	await render(false); await render();
	assert.equal(dom.container.querySelectorAll('[data-track-folder-row]').length, 1, 'new write ownership retires inspection overrides');
	assert.deepEqual(edits, []); assert.equal(JSON.stringify(project), original);
});
