/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { createDocumentMasteringSequenceSnapshot } from '../src/common/editor/controller/document/document-mastering-sequence-snapshot.ts';
import SoundscaperMasteringSequenceDialog from '../src/common/editor/ui/dialogs/SoundscaperMasteringSequenceDialog.tsx';
import { SOUNDSCAPER_MASTERING_SEQUENCE_COPY } from '../src/common/editor/ui/soundscaper-mastering-sequence-copy.ts';
import { masteringRegionProject } from './helpers/next-mastering-region-project.ts';
import { reactProps } from './helpers/react-test-dom.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { createClipboardCustody, clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertEditedAudioArchiveCustody } from './helpers/edited-audio-archive-custody.ts';

type Custody = Awaited<ReturnType<typeof createClipboardCustody>>;
function Dialog({ controller, fixture }: Readonly<{ controller: Custody['controller']; fixture: ReturnType<typeof mountControllerDataDom> }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return <SoundscaperMasteringSequenceDialog controller={controller} snapshot={snapshot}
		copy={SOUNDSCAPER_MASTERING_SEQUENCE_COPY} run={fixture.run} onClose={() => undefined} />;
}

test('the mastering editor offers regions from its selected order sequence', async context => {
	const { controller, store, open } = await createClipboardCustody(context), fixture = mountControllerDataDom();
	await open(masteringRegionProject(), new Map());
	const before = clipboardProject(controller.project), document = createDocumentMasteringSequenceSnapshot(before);
	assert.equal(document.sequences.find(sequence => sequence.id === 'cut-order')!.deliverable, true);
	const entries = controller.getSnapshot().history.undoEntries.length;
	try {
		await fixture.render(<Dialog controller={controller} fixture={fixture} />);
		const picker = fixture.dom.one('[data-mastering-sequence-picker]');
		await act(async () => { reactProps(picker).onChange({ currentTarget: { value: 'cut-order' } }); });
		const options = fixture.dom.container.querySelectorAll('option').map(option => option.getAttribute('value'));
		assert.ok(options.includes('cut-b'), 'the secondary order must offer its own new region');
		assert.ok(!options.includes('main-region'), 'a foreign region would make this order undeliverable');
		const region = fixture.dom.container.querySelectorAll('select').find(node => node !== picker); assert.ok(region);
		assert.deepEqual(region.querySelectorAll('option').map(node => [node.getAttribute('value'), node.textContent]), [['cut-a', 'Cut opening'], ['cut-b', 'Cut reprise']]);
		await act(async () => { reactProps(picker).onChange({ currentTarget: { value: 'main-order' } }); });
		const primary = fixture.dom.container.querySelectorAll('option').map(option => option.getAttribute('value'));
		assert.ok(primary.includes('main-region')); assert.ok(!primary.includes('cut-b'));
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries);
		await act(async () => { reactProps(picker).onChange({ currentTarget: { value: 'cut-order' } }); });
		await act(async () => { reactProps(region).onChange({ currentTarget: { value: 'cut-b' } }); });
		await act(async () => { reactProps(fixture.dom.one('[data-mastering-action="add-entry"]')).onClick(); await fixture.settle(); });
		const after = clipboardProject(controller.project), sequences = createDocumentMasteringSequenceSnapshot(after).sequences;
		const cut = sequences.find(sequence => sequence.id === 'cut-order'); assert.ok(cut); assert.equal(cut.deliverable, true);
		assert.deepEqual(cut.entries.map(entry => entry.annotationId), ['cut-a', 'cut-b']);
		const authored = after.masteringSequences.find(sequence => sequence.id === 'cut-order'); assert.ok(authored);
		assert.equal(authored.entries.length, 2); const added = authored.entries[1]; assert.ok(added);
		assert.deepEqual(clipboardDocument(after), { ...clipboardDocument(before), masteringSequences: before.masteringSequences.map(sequence => sequence.id === 'cut-order'
			? { ...sequence, entries: [...sequence.entries, { id: added.id, annotationId: 'cut-b', title: null, metadata: {}, gapBeforeFrames: 0, fadeInFrames: 0, fadeOutFrames: 0 }] } : sequence) });
		assert.equal(fixture.dom.container.textContent.includes('This sequence cannot be delivered'), false);
		assert.equal(fixture.dom.container.querySelectorAll('[data-mastering-entry]').length, 2);
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
		await act(async () => { controller.actions.edit.undo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		await act(async () => { controller.actions.edit.redo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(after));
		await act(async () => { await controller.actions.project.flush(); });
		const reopened = await assertEditedAudioArchiveCustody(context, store, controller.project, []);
		assert.deepEqual(clipboardDocument(reopened), clipboardDocument(after));
	} finally { await fixture.dispose(); }
});
