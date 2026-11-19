/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FramescaperVisualInspectorDialog from '../src/common/editor/ui/dialogs/FramescaperVisualInspectorDialog.tsx';
import FramescaperSelectedVisualAuthoringDialog from '../src/common/editor/ui/dialogs/FramescaperSelectedVisualAuthoringDialog.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { normalizeVideoMaskMatteGraphV1 } from '../src/common/editor/video-mask-matte-v24.ts';
import { normalizeVideoVisualPresentationV1 } from '../src/common/editor/video-visual-presentation-v27.ts';
import { currentReviewedVideoProject, reviewedVideoProjectCustody } from './helpers/reviewed-video-project-custody.ts';
import { reopenVisualAuthoringArchive } from './helpers/framescaper-visual-authoring-archive-custody.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';

const compoundMask = { schemaVersion: 1, id: 'compound', kind: 'mask', inputs: [],
	nodes: [{ id: 'inverse', kind: 'invert', inputNodeId: 'shape' },
		{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x: 0.1, y: 0.1, width: 0.6, height: 0.6 }], outputNodeId: 'inverse' };

function authored(value: unknown) {
	const { revision: _revision, updatedAt: _updatedAt, selection: _selection, ...document } = currentReviewedVideoProject(value);
	return document;
}

test('real imported compound mask survives Inspector opacity, complex eligibility, fresh attachment, history and Scape', async context => {
	const original = createFramescaperProject(PROFILE, { id: 'compound-mask',
		visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'source', name: 'Masked title',
			width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 150,
			generator: { kind: 'solid', color: '#ffffffff' } }], maskMattes: [compoundMask] },
		clips: [{ schemaVersion: 1, kind: 'generator', id: 'masked', sourceId: 'source', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['masked'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main',
		finishing: { visualPresentations: [{ schemaVersion: 1, id: 'view', owner: { kind: 'clip', id: 'masked' }, enabled: true,
			opacity: 1, blendMode: 'normal', grade: null, processorStackId: null, maskMatteIds: ['compound'] }] } });
	const donor = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	const archive = await (async () => {
		try { return await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(original, donor); }
		finally { await donor.close(); }
	})();
	assert.ok(archive.blob);
	const editor = await reviewedVideoProjectCustody(context, [], { num: 30, den: 1 });
	await editor.controller.actions.project.openScapeFile(new File([archive.blob], 'Compound.fscape', { type: 'application/zip' }), () => 'copy');
	assert.equal(editor.controller.getSnapshot().readOnly, false);
	assert.deepEqual(currentReviewedVideoProject(editor.controller.project), original);
	await editor.controller.actions.timeline.selectClip('masked');
	const baseline = currentReviewedVideoProject(editor.controller.project), entries = editor.controller.getSnapshot().history.undoEntries.length;
	const fixture = mountControllerDataDom();
	const persisted = async () => {
		await editor.controller.actions.project.flush();
		const project = currentReviewedVideoProject(editor.controller.project);
		assert.deepEqual(await editor.environment.store.loadProject(project.id), project);
		return project;
	};
	try {
		await fixture.render(<FramescaperVisualInspectorDialog controller={editor.controller} project={editor.controller.project}
			selectedClipId="masked" editingBlocked={false} readOnly={false} run={fixture.run} onClose={() => undefined} />);
		await act(async () => { reactProps(fixture.dom.one('[data-visual-inspector-opacity]')).onChange({ currentTarget: { value: '0.5' } }); });
		await act(async () => {
			reactProps(fixture.dom.one('[id="framescaper-visual-inspector-form"]')).onSubmit({ preventDefault() {} }); await fixture.settle();
		});
		assert.equal(fixture.dom.one('[role="status"]').textContent, 'Selected visual updated.');
		const opacity = await persisted();
		assert.deepEqual(opacity.videoMaskMattes, [compoundMask]);
		assert.ok(Array.isArray(baseline.videoVisualPresentations));
		const presentation = normalizeVideoVisualPresentationV1(baseline.videoVisualPresentations[0]);
		assert.deepEqual(authored(opacity), { ...authored(baseline), videoVisualPresentations: [{ ...presentation, opacity: 0.5 }] });
		assert.equal(editor.controller.getSnapshot().history.undoEntries.length, entries + 1);
		await editor.controller.actions.edit.undo(); assert.deepEqual(authored(await persisted()), authored(baseline));

		await fixture.render(<FramescaperSelectedVisualAuthoringDialog surface="video-mask-matte" controller={editor.controller}
			project={editor.controller.project} selectedClipId="masked" playheadSample={0} editingBlocked={false} readOnly={false}
			run={fixture.run} onClose={() => undefined} />);
		for (const field of ['apply', 'mask-shape', 'mask-width'])
			assert.notEqual(fixture.dom.one(`[data-framescaper-authoring-${field}]`).getAttribute('disabled'), null, `complex ${field} is disabled`);
		assert.equal(fixture.dom.one('[data-framescaper-authoring-remove]').getAttribute('disabled'), null);
		const attached = fixture.dom.one('[data-framescaper-authoring-mask]'); assert.equal(reactProps(attached).value, 'compound');
		await act(async () => { reactProps(attached).onChange({ currentTarget: { value: '' } }); });
		const width = fixture.dom.one('[data-framescaper-authoring-mask-width]'); assert.equal(width.getAttribute('disabled'), null);
		await act(async () => { reactProps(width).onChange({ currentTarget: { value: '0.4' } }); });
		assert.equal(width.value, '0.4');
		await act(async () => { reactProps(fixture.dom.one('[data-framescaper-authoring-apply]')).onClick(); await fixture.settle(); });
		assert.equal(fixture.dom.one('[role="status"]').textContent, 'Selected authored state applied.');
		const applied = await persisted();
		assert.ok(Array.isArray(applied.videoMaskMattes));
		const masks = applied.videoMaskMattes.map(value => normalizeVideoMaskMatteGraphV1(value));
		assert.equal(masks.length, 2); assert.deepEqual(masks.find(mask => mask.id === 'compound'), compoundMask);
		const fresh = masks.find(mask => mask.id !== 'compound'); assert.ok(fresh);
		const node = fresh.nodes[0]; assert.ok(node); assert.equal(fresh.nodes.length, 1);
		assert.deepEqual(fresh, { schemaVersion: 1, id: fresh.id, kind: 'mask', inputs: [], outputNodeId: node.id,
			nodes: [{ id: node.id, kind: 'vector-shape', shape: 'rectangle', x: 0.3, y: 0.125, width: 0.4, height: 0.75 }] });
		assert.deepEqual(authored(applied), { ...authored(baseline), videoMaskMattes: applied.videoMaskMattes,
			videoVisualPresentations: [{ ...presentation, maskMatteIds: ['compound', fresh.id] }] });
		assert.equal(editor.controller.getSnapshot().history.undoEntries.length, entries + 1, 'fresh attachment replaces the undone opacity branch');
		assert.equal(editor.controller.getSnapshot().history.redoEntries.length, 0);
		await editor.controller.actions.edit.undo(); assert.deepEqual(authored(await persisted()), authored(baseline));
		await editor.controller.actions.edit.redo(); assert.deepEqual(authored(await persisted()), authored(applied));
		const final = currentReviewedVideoProject(editor.controller.project);
		const reopened = await reopenVisualAuthoringArchive(final, editor.environment.store);
		assert.deepEqual(reopened.videoMaskMattes, applied.videoMaskMattes);
		assert.deepEqual(reopened.videoVisualPresentations, applied.videoVisualPresentations);
	} finally { await fixture.dispose(); }
});
