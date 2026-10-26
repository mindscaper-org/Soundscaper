/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document/document-track-folder-snapshot.ts';
import { useSearchFolderReveal } from '../src/common/editor/ui/timeline/useSearchFolderReveal.ts';
import { inspectTrackFolderSnapshot } from '../src/common/editor/ui/timeline/track-folder-inspection-snapshot.ts';
import { editorProjectEditSessionKey } from '../src/common/editor/ui/project-edit-session-key.ts';
import { useWorkspaceSearchRuntime } from '../src/common/editor/ui/workspace/useWorkspaceSearchRuntime.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const currentOwner of [false, true]) test(`Search expansion owns the active project: ${currentOwner}`, async context => {
	const source = createAudioSource({ id: 'source', frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, sourceDurationFrames: 48_000 });
	const project = createSoundscaperProject({ id: 'search-folder', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })], primarySequenceId: 'main',
		trackFolders: [{ id: 'outer', name: 'Outer', collapsed: true, mute: true },
			{ id: 'inner', name: 'Inner', collapsed: true }, { id: 'other', name: 'Other', collapsed: true }],
		sequences: [{ id: 'main', trackNodes: [{ kind: 'folder', id: 'outer', parentFolderId: null },
			{ kind: 'folder', id: 'inner', parentFolderId: 'outer' }, { kind: 'track', id: 'track', parentFolderId: 'inner' },
			{ kind: 'folder', id: 'other', parentFolderId: null }] }] });
	const original = structuredClone(project), folders = createDocumentTrackFolderSnapshot(project);
	const controller = { captureProjectGeneration: () => ({ projectId: project.id, generation: 7 }) };
	const request = { clipId: clip.id, projectIdentity: currentOwner ? editorProjectEditSessionKey(controller, project.id) : 'retired' };
	let overrides = new Map<string, boolean>();
	function View() {
		const [value, setValue] = useState(() => new Map<string, boolean>());
		overrides = value;
		useSearchFolderReveal(project, controller, request, folders, setValue);
		const inspected = inspectTrackFolderSnapshot(folders, value);
		return <button onClick={() => setValue(current => new Map(current).set('outer', true))}>
			{String(inspected?.sequences[0]?.rows.find(row => row.id === 'track')?.rowHidden)}
		</button>;
	}
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const beforeReact = globals.React, beforeAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	context.after(async () => { await act(async () => root.unmount()); dom.restore(); globals.React = beforeReact; globals.IS_REACT_ACT_ENVIRONMENT = beforeAct; });
	await act(async () => root.render(<View />));
	assert.equal(dom.one('button').textContent, String(!currentOwner));
	assert.equal(overrides.has('other'), false, 'unrelated folders retain their saved view');
	assert.deepEqual(project, original, 'local expansion never unmutes or edits the document');
	if (!currentOwner) return;
	assert.equal(overrides.get('inner'), false);
	await act(async () => reactProps(dom.one('button')).onClick?.());
	await act(async () => root.render(<View />));
	assert.equal(dom.one('button').textContent, 'true', 'one search request does not reopen a folder the user subsequently collapses');
});

test('read-only Search requests a local reveal without invoking a document selection edit', async context => {
	const project = { id: 'retained-project', sources: [], clips: [], tracks: [] };
	let selections = 0;
	const requests: unknown[] = [];
	const controller = { project: null, captureProjectGeneration: () => { throw new Error('Inactive writer'); },
		actions: { timeline: { selectClip: () => { selections += 1; } } } };
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const beforeReact = globals.React, beforeAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	context.after(async () => { await act(async () => root.unmount()); dom.restore(); globals.React = beforeReact; globals.IS_REACT_ACT_ENVIRONMENT = beforeAct; });
	function View() {
		const { activateSearchEntry } = useWorkspaceSearchRuntime({ applicationMenus: [], controller,
			editorRef: { current: dom.container }, openWorkspacePanel: () => undefined, parityRuntime: { actions: {} }, project,
			run: (operation: () => unknown) => operation(), snapshot: { readOnly: true },
			setProjectBinSearchReveal: () => undefined, setTimelineSearchReveal: (request: unknown) => requests.push(request) });
		return <button onClick={() => activateSearchEntry({ kind: 'timeline', target: { clipId: 'recording' } })}>Reveal</button>;
	}
	await act(async () => root.render(<View />));
	await act(async () => reactProps(dom.one('button')).onClick?.());
	assert.equal(selections, 0);
	assert.deepEqual(requests, [{ clipId: 'recording', revision: 1, projectIdentity: editorProjectEditSessionKey(controller, project.id) }]);
});
