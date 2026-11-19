/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import React, { act, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperSelectedVisualAuthoringDialog from '../src/common/editor/ui/dialogs/FramescaperSelectedVisualAuthoringDialog.tsx';
import { bindFramescaperSelectedAuthoringController } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { applyFramescaperOwnedVisualCommandVisual, snapshotFramescaperOwnedVisualCommandVisual } from '../src/framescaper/editor-project-visual-visual-command.ts';
import { applyFramescaperOwnedFinishingCommandFinishing, snapshotFramescaperOwnedFinishingCommandFinishing } from '../src/framescaper/editor-project-finishing-finishing-command.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { normalizeVideoVisualPresetV1 } from '../src/common/editor/video-visual-preset-v24.ts';
import { reviewedVideoProjectCustody, currentReviewedVideoProject } from './helpers/reviewed-video-project-custody.ts';
import { reopenVisualAuthoringArchive } from './helpers/framescaper-visual-authoring-archive-custody.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';

for (const kind of ['visual', 'finishing'] as const) for (const focusMode of ['body', 'retained', 'deliberate'] as const) {
	test(`production ${kind} preset removal ${focusMode === 'deliberate' ? 'preserves deliberate focus' : `recovers its picker from ${focusMode}`}`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		let project: Record<string, unknown> = {
			schemaFamily: 'framescaper', schemaVersion: 1, id: 'project', revision: 0, sampleRate: 48_000,
			selection: { clipIds: ['picture'] }, primarySequenceId: 'sequence',
			sequences: [{ id: 'sequence', trackIds: ['track'], rate: { num: 30, den: 1 } }],
			tracks: [{ id: 'track', type: 'video', clipIds: ['picture'] }],
			clips: [{ id: 'picture', kind: 'generator', sourceId: 'source', sequenceId: 'sequence',
				sequenceStartFrame: 0, sequenceFrameCount: 150 }],
			sources: [{ id: 'source', kind: 'generator', name: 'Solid', generator: { kind: 'solid', color: '#000000ff' } }],
			videoAdjustmentLayers: [], videoVisualPresentations: [], videoMaskMattes: [], videoFreezeFallbacks: [],
			videoVisualPresets: kind === 'visual' ? [{ schemaVersion: 1, kind: 'video-preset', id: 'saved',
				name: 'Keyboard solid', modelKind: 'generator', authoredStateSha256: 'ab'.repeat(32) }] : [],
			videoFinishingPresets: kind === 'finishing' ? [{ schemaVersion: 1, kind: 'video-finishing-preset',
				id: 'saved', name: 'Keyboard finish', template: { enabled: true, opacity: 0.5, blendMode: 'screen', grade: null } }] : [],
		};
		let removal: ReactTestElement;
		let other: ReactTestElement;
		let commits = 0;
		const controller = { get project() { return project; },
			getSnapshot: () => ({ selectedClipId: 'picture' }), getTelemetrySnapshot: () => ({ positionFrame: 0 }),
			actions: { edit: { commit(value: unknown) {
				const next = structuredClone(project);
				if (kind === 'visual') applyFramescaperOwnedVisualCommandVisual(next, snapshotFramescaperOwnedVisualCommandVisual(value));
				else applyFramescaperOwnedFinishingCommandFinishing(next, snapshotFramescaperOwnedFinishingCommandFinishing(value));
				project = next;
				commits += 1;
				// Native disabling of the focused action loses focus to BODY; the public browser proves this behavior.
				if (focusMode === 'deliberate') other.focus();
				else if (focusMode === 'body') removal.ownerDocument.body.focus();
				render();
			} } } };
		bindFramescaperSelectedAuthoringController({ controller, store: {} as AudioEditorProjectStore });
		const render = (): void => { root.render(<FramescaperSelectedVisualAuthoringDialog surface="video-visual-preset"
			controller={controller} project={project} selectedClipId="picture" playheadSample={0}
			editingBlocked={false} readOnly={false} run={operation => operation()} onClose={() => {}} />); };
		try {
			await act(async () => { render(); });
			removal = dom.one(`[data-framescaper-authoring-remove-${kind === 'visual' ? 'visual' : 'finishing'}]`);
			other = dom.one('[data-framescaper-authoring-preset-name]');
			const picker = dom.one(`[data-framescaper-authoring-${kind}-preset]`);
			removal.focus();
			await act(async () => { reactProps(removal).onClick(); });
			assert.equal(commits, 1);
			assert.equal(reactProps(removal).disabled, true);
			assert.equal(picker.value, '', 'the existing removed-identity reconciliation remains intact');
			assert.equal(picker.ownerDocument.activeElement === (focusMode === 'deliberate' ? other : picker), true);
		} finally {
			await act(async () => { root.unmount(); });
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}

test('actual Solid My solid preset removal retires both action targets through controller history, store and fresh Scape', async context => {
	const editor = await reviewedVideoProjectCustody(context, [], { num: 30, den: 1 });
	const { controller, environment } = editor;
	const author = framescaperCandidateAuthoringActionRuntimeFor(controller); assert.ok(author); await author.run('video-solid');
	const initial = currentReviewedVideoProject(controller.project), clip = normalizeVideoGeneratorClipV1(initial.clips.at(-1));
	const source = normalizeVideoGeneratorSourceV1(initial.sources.find(value => value.id === clip.sourceId));
	assert.deepEqual([clip.sequenceStartFrame, clip.sequenceFrameCount, clip.sourceInFrame, clip.sourceFrameCount], [0, 150, 0, 150]);
	assert.deepEqual([source.width, source.height, source.frameRate, source.frameCount, source.generator], [1920, 1080, { num: 30, den: 1 }, 150, { kind: 'solid', color: '#000000ff' }]);
	await controller.actions.timeline.selectClip(clip.id);
	const fixture = mountControllerDataDom(), entries = controller.getSnapshot().history.undoEntries.length;
	function Dialog() {
		const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		return <FramescaperSelectedVisualAuthoringDialog surface="video-visual-preset" controller={controller}
			project={snapshot.project} selectedClipId={snapshot.selectedClipId} playheadSample={0}
			editingBlocked={false} readOnly={false} run={fixture.run} onClose={() => undefined} />;
	}
	const document = (value: unknown) => {
		const { revision: _revision, updatedAt: _updatedAt, selection: _selection, ...authored } = currentReviewedVideoProject(value); return authored;
	};
	try {
		await fixture.render(<Dialog />);
		await act(async () => { reactProps(fixture.dom.one('[data-framescaper-authoring-preset-name]')).onChange({ currentTarget: { value: 'My solid' } }); });
		await act(async () => { reactProps(fixture.dom.one('[data-framescaper-authoring-save-visual]')).onClick(); await fixture.settle(); });
		assert.equal(fixture.dom.one('[role="status"]').textContent, 'Selected visual preset saved.');
		const saved = currentReviewedVideoProject(controller.project); assert.ok(Array.isArray(saved.videoVisualPresets));
		assert.equal(saved.videoVisualPresets.length, 1); const preset = normalizeVideoVisualPresetV1(saved.videoVisualPresets[0]);
		assert.equal(preset.name, 'My solid'); assert.equal(preset.modelKind, 'generator');
		const donor = normalizeVideoGeneratorClipV1(saved.projectBin.clips[0]);
		const donorSource = normalizeVideoGeneratorSourceV1(saved.sources.find(value => value.id === donor.sourceId));
		assert.deepEqual(donor, { ...clip, id: donor.id, sourceId: donorSource.id }); assert.notEqual(donor.id, clip.id);
		assert.deepEqual(donorSource, { ...source, id: donorSource.id, name: 'My solid Model' }); assert.notEqual(donorSource.id, source.id);
		assert.equal(preset.authoredStateSha256, createHash('sha256').update(JSON.stringify({ ...source, id: donorSource.id, name: 'My solid Model' })).digest('hex'));
		assert.deepEqual(saved.clips, initial.clips); assert.deepEqual(saved.tracks, initial.tracks);
		assert.deepEqual(saved.sources, [...initial.sources, donorSource]); assert.equal(saved.projectBin.clips.length, 1);
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
		const picker = fixture.dom.one('[data-framescaper-authoring-visual-preset]');
		await act(async () => { reactProps(picker).onChange({ currentTarget: { value: preset.id } }); });
		assert.equal(reactProps(picker).value, preset.id);
		assert.equal(fixture.dom.one('[data-framescaper-authoring-apply-visual]').hasAttribute('disabled'), false);
		assert.equal(fixture.dom.one('[data-framescaper-authoring-remove-visual]').hasAttribute('disabled'), false);
		await act(async () => { reactProps(fixture.dom.one('[data-framescaper-authoring-remove-visual]')).onClick(); await fixture.settle(); });
		assert.equal(fixture.dom.one('[role="status"]').textContent, 'Selected authored state removed.');
		assert.equal(reactProps(picker).value, '');
		for (const action of ['apply', 'remove']) assert.equal(fixture.dom.one(`[data-framescaper-authoring-${action}-visual]`).hasAttribute('disabled'), true);
		const expected = { ...document(saved), videoVisualPresets: [] };
		assert.deepEqual(document(controller.project), expected);
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 2);
		await act(async () => { controller.actions.edit.undo(); }); assert.deepEqual(document(controller.project), document(saved));
		await act(async () => { controller.actions.edit.redo(); }); assert.deepEqual(document(controller.project), expected);
		await act(async () => { await controller.actions.project.flush(); }); const final = currentReviewedVideoProject(controller.project);
		assert.deepEqual(await environment.store.loadProject(final.id), final);
		assert.deepEqual(document(await reopenVisualAuthoringArchive(final, environment.store)), expected);
	} finally { await fixture.dispose(); }
});
