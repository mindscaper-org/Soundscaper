/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createClipboardCustody, clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertEditedAudioArchiveCustody } from './helpers/edited-audio-archive-custody.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { COPY } from './helpers/audio-editor-controller-harness.js';
import { reactProps } from './helpers/react-test-dom.ts';

type Controller = Awaited<ReturnType<typeof createClipboardCustody>>['controller'];
type Fixture = ReturnType<typeof mountControllerDataDom>;

function Manager({ controller, fixture, blocked }: Readonly<{ controller: Controller; fixture: Fixture; blocked: boolean }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return <WorkspacePanelContent panelId="labels" controller={controller} snapshot={snapshot}
		copy={{ ...COPY, ...ENGLISH_COPY, select: 'Time selection' }} locale="en"
		run={fixture.run} fileService={null} playbackMeterSettings={null} showArmControls={false}
		displayAudioSupported={false} onOpenEffects={() => assert.fail('Label management must not open effects.')}
		effectsPanelTarget={null} onEffectWindowChange={() => assert.fail('Label management has no effect window.')} blocked={blocked} />;
}

for (const blocked of [false, true]) test(`Manage labels honors host locks and workspace blocking=${blocked}`, async context => {
	const session = await createClipboardCustody(context), { controller, store } = session;
	const original = createSoundscaperProject({ id: 'protected-manager-file', tracks: [
		{ id: 'locked', type: 'label', name: 'Protected cues', locked: true, labels: [{ id: 'keep', title: 'Keep me', startFrame: 0, endFrame: 48_000 }] },
		{ id: 'editable', type: 'label', name: 'Editable cues', labels: [{ id: 'edit', title: 'Edit me', startFrame: 0, endFrame: 48_000 }] },
	] });
	await session.open(original, new Map());
	controller.actions.timeline.selectTrack('locked');
	const before = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries.length;
	assert.deepEqual(clipboardDocument(before), clipboardDocument(original), 'every original protected cue survives real Scape admission');
	assert.throws(() => controller.actions.labels.update('locked', 'keep', { title: 'Forbidden' }), /locked/u);
	assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	const fixture = mountControllerDataDom();
	try {
		await fixture.render(<Manager controller={controller} fixture={fixture} blocked={blocked} />);
		for (const id of ['keep', 'edit']) {
			const row = fixture.dom.one(`[data-label-id="${id}"]`);
			const title = row.querySelector('input'); assert.ok(title);
			assert.equal(reactProps(title).disabled, blocked || id === 'keep', 'protected labels must not offer an uncommittable draft');
			const remove = row.querySelector('.kw-audio-editor__workspace-panel-close'); assert.ok(remove);
			assert.equal(reactProps(remove).disabled, blocked || id === 'keep');
			const select = row.querySelectorAll('button').find(button => button.textContent === 'Time selection'); assert.ok(select);
			assert.equal(reactProps(select).disabled, blocked, 'a host track lock still allows selecting its range');
		}
		const add = fixture.dom.container.querySelectorAll('button').find(button => button.textContent === ENGLISH_COPY.newLabel); assert.ok(add);
		assert.equal(reactProps(add).disabled, true, 'explicitly focused locked label track must not offer Add');
		if (blocked) {
			assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
			assert.equal(controller.getSnapshot().history.undoEntries.length, entries);
			return;
		}
		const peer = fixture.dom.one('[data-label-id="edit"]').querySelector('input'); assert.ok(peer);
		await act(async () => { reactProps(peer).onChange({ currentTarget: { value: 'Changed cue' } }); });
		assert.equal(peer.value, 'Changed cue');
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before), 'a draft is not yet committed');
		await act(async () => {
			// Supply only the DOM blur dispatch; the Enter and commit handlers are the mounted production row's.
			reactProps(peer).onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {},
				currentTarget: { blur() { reactProps(peer).onBlur(); } } });
			await fixture.settle();
		});
		const after = clipboardProject(controller.project);
		assert.deepEqual(clipboardDocument(after), { ...clipboardDocument(before), tracks: before.tracks.map(track => track.id === 'editable'
			? { ...track, labels: [{ id: 'edit', title: 'Changed cue', startFrame: 0, endFrame: 48_000,
				anchor: 'sample', startBeat: null, endBeat: null, color: 'auto', opaqueExtensions: {} }] } : track) });
		assert.equal(controller.getSnapshot().selectedTrackId, 'locked');
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
		assert.equal(peer.value, 'Changed cue');
		assert.equal(fixture.dom.container.querySelectorAll('[data-track-id="locked"]').length, 1);
		assert.equal(fixture.dom.container.querySelectorAll('[data-track-id="editable"]').length, 1);
		assert.equal(fixture.dom.find('[role="alert"]'), null);
		assert.equal(reactProps(add).disabled, true);
		await act(async () => { controller.actions.edit.undo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		assert.equal(peer.value, 'Edit me');
		await act(async () => { controller.actions.edit.redo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(after));
		assert.equal(peer.value, 'Changed cue');
		await act(async () => { await controller.actions.project.flush(); });
		const reopened = await assertEditedAudioArchiveCustody(context, store, controller.project, []);
		assert.deepEqual(clipboardDocument(reopened), clipboardDocument(after));
	} finally { await fixture.dispose(); }
});
