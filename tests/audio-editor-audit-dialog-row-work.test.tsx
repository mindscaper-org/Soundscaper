/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import NativePluginParameterControls, { type NativePluginParameterRuntime } from '../src/common/editor/ui/dialogs/NativePluginParameterControls.tsx';
import { useCommittedCallbacks } from '../src/common/editor/ui/useCommittedCallbacks.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
test('editing one native parameter leaves unchanged descriptor rows untouched', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const reads = Array.from({ length: 50 }, () => 0);
	const parameters = reads.map((_, i) => ({ index: i, id: `parameter-${i}`, get name() { reads[i] = (reads[i] ?? 0) + 1; return `Parameter ${i}`; }, label: '', defaultValue: 0.5, minimumValue: 0, maximumValue: 1, flags: 0 }));
	const runtime: NativePluginParameterRuntime = { capabilities: async () => ({ parameterCount: 50, hasVendorUi: false }), describeParameters: async () => parameters, readParameter: async () => 0.5, writeParameter: async (_id, _index, value) => value };
	try {
		await act(async () => root.render(<NativePluginParameterControls instanceId="native" runtime={runtime} />));
		const before = [...reads];
		const field = dom.one('[data-native-plugin-parameter="parameter-0"]');
		for (let tick = 0; tick < 5; tick++) await act(async () => reactProps(field).onChange?.({ currentTarget: { value: String(0.6 + tick / 20) } }));
		assert.deepEqual(reads.slice(1), before.slice(1));
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('retained row callbacks dispatch through the current committed owner', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let action: (() => string) | undefined;
	function View({ owner }: { owner: string }) { const stable = useCommittedCallbacks({ readOwner: () => owner }); action = stable.readOwner; return null; }
	try {
		await act(async () => root.render(<View owner="first" />));
		const retained = action;
		await act(async () => root.render(<View owner="second" />));
		assert.equal(action, retained);
		assert.equal(retained?.(), 'second');
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('mastering sequence name typing does not revisit unchanged entry forms', async () => {
	const { createSoundscaperProject } = await import('../src/soundscaper/editor-project.ts');
	const { createDocumentMasteringSequenceSnapshot } = await import('../src/common/editor/controller/document/document-mastering-sequence-snapshot.ts');
	const { default: Editor } = await import('../src/common/editor/ui/dialogs/SoundscaperMasteringSequenceEditor.tsx');
	const { SOUNDSCAPER_MASTERING_SEQUENCE_COPY } = await import('../src/common/editor/ui/soundscaper-mastering-sequence-copy.ts');
	const base = createSoundscaperProject({ id: 'mastering-work' });
	const project = createSoundscaperProject({ ...base, timelineAnnotations: [{ id: 'region', sequenceId: base.primarySequenceId, kind: 'region', anchor: 'sample', name: 'Region', startFrame: 0, endFrame: 48000, color: 'auto', batchId: null, opaqueExtensions: {} }], masteringSequences: [{ id: 'album', sequenceId: base.primarySequenceId, name: 'Album', entries: Array.from({ length: 20 }, (_, i) => ({ id: `entry-${i}`, annotationId: 'region' })) }] });
	const snapshot = createDocumentMasteringSequenceSnapshot(project);
	let titles = 0;
	const sequences = snapshot.sequences.map(sequence => ({ ...sequence, entries: sequence.entries.map(entry => ({ ...entry, get title() { titles++; return entry.title; } })) }));
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Editor copy={SOUNDSCAPER_MASTERING_SEQUENCE_COPY} disabled={false} sequences={sequences} regions={snapshot.regions} primarySequenceId={snapshot.primarySequenceId} createId={() => 'next'} onOperation={() => undefined} />));
		const initial = titles;
		const name = dom.container.querySelectorAll('input').find(input => input.name === 'name');
		assert.ok(name);
		for (const text of ['A', 'Al', 'Album revised']) await act(async () => reactProps(name).onChange?.({ currentTarget: { value: text } }));
		assert.equal(titles, initial);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('caption drafts never prepare hidden motion or LUT target inventories', async () => {
	const { default: Dialog } = await import('../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx');
	const { bindFramescaperMotionAnalysisActionsFinishing } = await import('../src/framescaper/editor-motion-analysis-actions-finishing.ts');
	const { bindFramescaperCubeLutActionsFinishing } = await import('../src/framescaper/editor-cube-lut-actions-finishing.ts');
	const { createFramescaperProject } = await import('../src/framescaper/editor-project.ts');
	const { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } = await import('../src/framescaper/editor-project-runtime-profile.ts');
	const { ENGLISH_COPY } = await import('../src/common/i18n/catalogs.js');
	const controller = { actions: { edit: { commit: () => undefined } } };
	let inventories = 0;
	const targets = () => { inventories++; return []; };
	bindFramescaperMotionAnalysisActionsFinishing(controller, { targets, analyze: async () => { throw new Error('unused'); } });
	bindFramescaperCubeLutActionsFinishing(controller, { targets, importCubeLut: async () => { throw new Error('unused'); } });
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { id: 'captions' });
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Dialog surface="captions" controller={controller} project={project} fileService={{}} editingBlocked={false} readOnly={false} copy={ENGLISH_COPY} run={operation => operation()} onClose={() => undefined} />));
		const field = dom.one('[data-framescaper-finishing-document]');
		for (const text of ['[', '[]']) await act(async () => reactProps(field).onChange?.({ currentTarget: { value: text } }));
		assert.equal(inventories, 0);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
