/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FramescaperSelectedVisualAuthoringDialog from '../src/common/editor/ui/dialogs/FramescaperSelectedVisualAuthoringDialog.tsx';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { normalizeVideoVisualPresetV1 } from '../src/common/editor/video-visual-preset-v24.ts';
import { currentReviewedVideoProject, reviewedVideoProjectCustody } from './helpers/reviewed-video-project-custody.ts';
import { reopenVisualAuthoringArchive } from './helpers/framescaper-visual-authoring-archive-custody.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';

function authored(value: unknown) {
	const { revision: _revision, updatedAt: _updatedAt, selection: _selection, ...document } = currentReviewedVideoProject(value);
	return document;
}

test('real Solid preset dialog saves the full512-character name, bounded donor and fresh Scape', async context => {
	const editor = await reviewedVideoProjectCustody(context, [], { num: 30, den: 1 });
	const author = framescaperCandidateAuthoringActionRuntimeFor(editor.controller); assert.ok(author);
	await author.run('video-solid');
	const initial = currentReviewedVideoProject(editor.controller.project);
	const clip = normalizeVideoGeneratorClipV1(initial.clips.at(-1));
	const originalSource = normalizeVideoGeneratorSourceV1(initial.sources.find(source => source.id === clip.sourceId));
	assert.equal(originalSource.generator.kind, 'solid');
	await editor.controller.actions.timeline.selectClip(clip.id);
	const before = currentReviewedVideoProject(editor.controller.project), entries = editor.controller.getSnapshot().history.undoEntries.length;
	const fixture = mountControllerDataDom();
	const render = async (project: unknown = editor.controller.project) => {
		await fixture.render(<FramescaperSelectedVisualAuthoringDialog surface="video-visual-preset" controller={editor.controller}
			project={project} selectedClipId={clip.id} playheadSample={0} editingBlocked={false} readOnly={false} run={fixture.run} onClose={() => undefined} />);
	};
	const name = 'A'.repeat(512);
	try {
		await render();
		await act(async () => { reactProps(fixture.dom.one('[data-framescaper-authoring-preset-name]')).onChange({ currentTarget: { value: name } }); });
		assert.equal(fixture.dom.one('[data-framescaper-authoring-preset-name]').value, name);
		await act(async () => { reactProps(fixture.dom.one('[data-framescaper-authoring-save-visual]')).onClick(); await fixture.settle(); });
		assert.equal(fixture.dom.one('[role="status"]').textContent, 'Selected visual preset saved.');
		const saved = currentReviewedVideoProject(editor.controller.project);
		assert.ok(Array.isArray(saved.videoVisualPresets)); assert.equal(saved.videoVisualPresets.length, 1);
		const preset = normalizeVideoVisualPresetV1(saved.videoVisualPresets[0]); assert.equal(preset.name, name);
		assert.equal(editor.controller.getSnapshot().history.undoEntries.length, entries + 1);
		const donor = normalizeVideoGeneratorClipV1(saved.projectBin.clips.at(-1));
		const source = normalizeVideoGeneratorSourceV1(saved.sources.find(source => source.id === donor.sourceId));
		assert.notEqual(source.id, originalSource.id); assert.equal(source.name, 'A'.repeat(506) + ' Model');
		assert.deepEqual(source.generator, originalSource.generator);
		assert.deepEqual(saved.clips, before.clips); assert.deepEqual(saved.tracks, before.tracks);
		assert.deepEqual(saved.sources.find(source => source.id === originalSource.id), before.sources.find(source => source.id === originalSource.id));
		await render();
		const select = fixture.dom.one('[data-framescaper-authoring-visual-preset]');
		const option = select.querySelectorAll('option').find(option => option.textContent === name); assert.ok(option);
		assert.equal(option.getAttribute('value'), preset.id);
		await act(async () => { reactProps(select).onChange({ currentTarget: { value: preset.id } }); });
		assert.equal(reactProps(select).value, preset.id);
		assert.equal(fixture.dom.one('[data-framescaper-authoring-apply-visual]').getAttribute('disabled'), null);
		await editor.controller.actions.edit.undo(); assert.deepEqual(authored(editor.controller.project), authored(before));
		await editor.controller.actions.edit.redo(); assert.deepEqual(authored(editor.controller.project), authored(saved));
		await editor.controller.actions.project.flush();
		const current = currentReviewedVideoProject(editor.controller.project); assert.deepEqual(await editor.environment.store.loadProject(current.id), current);
		const reopened = await reopenVisualAuthoringArchive(current, editor.environment.store);
		await render(reopened);
		assert.equal(fixture.dom.one('[data-framescaper-authoring-visual-preset]').querySelectorAll('option').find(option => option.getAttribute('value') === preset.id)?.textContent, name);
	} finally { await fixture.dispose(); }
});
