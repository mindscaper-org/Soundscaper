/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
	createAudioEditorSearchEntries, prepareAudioEditorSearchEntries, searchAudioEditorEntries,
} from '../src/common/editor/search.js';
import { useWorkspaceSearchRuntime } from '../src/common/editor/ui/workspace/useWorkspaceSearchRuntime.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('owned search entries normalize fields once and preserve every ranking tier', context => {
	const entries = createAudioEditorSearchEntries({
		menus: [{ label: 'Effekt', items: [{ id: 'audacity-amplify', label: 'Verstärken', disabled: true },
			{ id: 'open', label: 'Open', onClick: () => undefined }] }],
		project: {
			sources: [{ id: 'source', name: 'Café 🎙️ Straße.wav' }],
			tracks: [{ id: 'track', name: 'Dialogue', clipIds: ['clip'] }],
			clips: [{ id: 'clip', sourceId: 'source', title: 'Blue Café Ambience' }],
			projectBin: { clips: [{ id: 'bin', sourceId: 'source', title: 'Deepblue ambience' }] },
		},
	});
	const queries = ['', 'blue ambience', 'cafe', '🎙️', 'strasse', 'amplfy', 'make this louder', 'zzzz'];
	const expected = queries.map(query => searchAudioEditorEntries(entries, query).map(entry => entry.key));
	const normalize = String.prototype.normalize;
	let calls = 0;
	String.prototype.normalize = function (form?: string) { calls += 1; return normalize.call(this, form); };
	context.after(() => { String.prototype.normalize = normalize; });
	const owned = prepareAudioEditorSearchEntries(entries);
	assert.equal(calls, 0, 'closed search does not normalize the media inventory');
	queries.forEach((query, index) => assert.deepEqual(
		searchAudioEditorEntries(owned, query).map(entry => entry.key), expected[index],
	));
	const firstPassCalls = calls;
	assert.ok(firstPassCalls > queries.length);
	for (let repeat = 0; repeat < 3; repeat++) {
		queries.forEach((query, index) => assert.deepEqual(
			searchAudioEditorEntries(owned, query).map(entry => entry.key), expected[index],
		));
	}
	assert.equal(calls - firstPassCalls, queries.length * 3, 'only the query is normalized after preparation');
	assert.equal(owned[1]!.handler, entries[1]!.handler);
	assert.equal(owned[0]!.disabled, true);
});

test('preparation owns searchable arrays while ordinary mutable entries remain live', () => {
	const entry = { key: 'entry', label: 'Original', aliases: ['old alias'], terms: ['old term'], sourceOrder: 0 };
	const owned = prepareAudioEditorSearchEntries([entry]);
	entry.label = 'Changed'; entry.aliases[0] = 'new alias'; entry.terms[0] = 'new term';
	assert.equal(searchAudioEditorEntries(owned, 'original')[0]?.key, 'entry');
	assert.equal(searchAudioEditorEntries(owned, 'old alias')[0]?.key, 'entry');
	assert.equal(searchAudioEditorEntries(owned, 'old term')[0]?.key, 'entry');
	assert.equal(searchAudioEditorEntries(owned, 'changed').length, 0);
	assert.equal(searchAudioEditorEntries([entry], 'changed')[0]?.key, 'entry');
	assert.equal(searchAudioEditorEntries([entry], 'new alias')[0]?.key, 'entry');
	assert.ok(Object.isFrozen(owned));
	assert.ok(Object.isFrozen(owned[0]));
	assert.ok(Object.isFrozen(owned[0]!.terms));
});

test('mutable text objects retain uncached search behavior', () => {
	let label = 'First';
	const entries = prepareAudioEditorSearchEntries([{ key: 'object', label: { toString: () => label } }]);
	assert.equal(searchAudioEditorEntries(entries, 'first')[0]?.key, 'object');
	label = 'Second';
	assert.equal(searchAudioEditorEntries(entries, 'second')[0]?.key, 'object');
	assert.equal(searchAudioEditorEntries(entries, 'first').length, 0);
});

test('prepared search text has bounded entry and character retention', context => {
	const normalize = String.prototype.normalize;
	let calls = 0;
	String.prototype.normalize = function (form?: string) { calls += 1; return normalize.call(this, form); };
	context.after(() => { String.prototype.normalize = normalize; });
	const entries = prepareAudioEditorSearchEntries(Array.from({ length: 16_385 }, (_, index) => ({
		key: String(index), label: `Entry ${String(index)}`, sourceOrder: index,
	})));
	searchAudioEditorEntries(entries, 'entry');
	calls = 0;
	assert.equal(searchAudioEditorEntries(entries, 'entry').length, 50);
	assert.equal(calls, 4, 'the query and the one uncached entry are normalized; retained entries do not churn');
	const oversized = prepareAudioEditorSearchEntries([{ key: 'large', label: 'a'.repeat(4 * 1_024 * 1_024 + 1) }]);
	assert.equal(searchAudioEditorEntries(oversized, 'a')[0]?.key, 'large');
	calls = 0;
	assert.equal(searchAudioEditorEntries(oversized, 'a')[0]?.key, 'large');
	assert.ok(calls > 1, 'a single oversized value is searched without retaining its normalized copy');
});

test('menu refreshes reuse media indexing while updating command availability and source order', async context => {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const beforeReact = globals.React, beforeAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	context.after(async () => { await act(async () => root.unmount()); dom.restore(); globals.React = beforeReact; globals.IS_REACT_ACT_ENVIRONMENT = beforeAct; });
	let reads = 0;
	const binClips: Array<{ id: string; sourceId: string; title: string }> = [];
	let project = { id: 'project', sources: [{ id: 'source', get name() { reads += 1; return 'Take.wav'; } }],
		tracks: [{ id: 'track', name: 'Track', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: 'source', title: 'Take' }], projectBin: { clips: binClips } };
	let latest: ReturnType<typeof useWorkspaceSearchRuntime>['searchEntries'] = [];
	function View({ disabled, extra = false }: { disabled: boolean; extra?: boolean }) {
		const runtime = useWorkspaceSearchRuntime({
			applicationMenus: [{ label: 'File', items: [{ id: 'open', label: 'Open', disabled, onClick: () => undefined },
				...(extra ? [{ id: 'save', label: 'Save', onClick: () => undefined }] : [])] }],
			project: { ...project }, controller: {}, editorRef: { current: dom.container },
			openWorkspacePanel: () => undefined, parityRuntime: { actions: {} }, run: () => undefined,
			setProjectBinSearchReveal: () => undefined, setTimelineSearchReveal: () => undefined, snapshot: {},
		});
		latest = runtime.searchEntries;
		return null;
	}
	await act(async () => root.render(<View disabled={false} />));
	const initialReads = reads;
	const initialMedia = latest.find(entry => entry.kind === 'timeline');
	assert.ok(initialReads > 0);
	await act(async () => root.render(<View disabled={true} />));
	assert.equal(reads, initialReads, 'menu state and containing-project replacements do not revisit media');
	assert.equal(latest.find(entry => entry.kind === 'timeline'), initialMedia);
	assert.equal(latest.find(entry => entry.commandId === 'open')?.disabled, true);
	await act(async () => root.render(<View disabled={false} extra={true} />));
	assert.deepEqual(latest.map(entry => entry.sourceOrder), [0, 1, 2]);
	project = { ...project, sources: [{ id: 'source', name: 'RenamedSource' }] };
	await act(async () => root.render(<View disabled={false} extra={true} />));
	assert.equal(searchAudioEditorEntries(latest, 'RenamedSource')[0]?.key, 'timeline:clip');
	project = { ...project, tracks: [{ ...project.tracks[0]!, name: 'RenamedTrack' }] };
	await act(async () => root.render(<View disabled={false} extra={true} />));
	assert.equal(searchAudioEditorEntries(latest, 'RenamedTrack')[0]?.key, 'timeline:clip');
	project = { ...project, clips: [{ ...project.clips[0]!, title: 'RenamedClip' }] };
	await act(async () => root.render(<View disabled={false} extra={true} />));
	assert.equal(searchAudioEditorEntries(latest, 'RenamedClip')[0]?.key, 'timeline:clip');
	project = { ...project, projectBin: { clips: [{ id: 'bin', sourceId: 'source', title: 'NewBinItem' }] } };
	await act(async () => root.render(<View disabled={false} extra={true} />));
	assert.equal(searchAudioEditorEntries(latest, 'NewBinItem')[0]?.key, 'project-bin:bin');
});
