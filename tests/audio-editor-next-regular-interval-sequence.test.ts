/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { RegularIntervalAnnotationDialog } from '../src/common/editor/ui/dialogs/ImportAnalysisDialogs.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createClipboardCustody, clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { regularIntervalDialogDefaults } from '../src/common/editor/ui/regular-interval-dialog-defaults.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

for (const primaryFrames of [48_000, 480_000]) test(`regular annotation defaults follow their destination sequence (${primaryFrames} samples)`, async context => {
	const project = createSoundscaperProject({ id: 'interval-sequences', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'pcm', frameCount: 480_000, sampleRate: 48_000, channelCount: 1 })],
		clips: [createAudioClip({ id: 'own', sourceId: 'pcm', sourceDurationFrames: primaryFrames, durationFrames: primaryFrames }),
			createAudioClip({ id: 'foreign', sourceId: 'pcm', sourceDurationFrames: 480_000, durationFrames: 480_000 })],
		tracks: [createAudioTrack({ id: 'one', clipIds: ['own'] }), createAudioTrack({ id: 'two', clipIds: ['foreign'] })],
		sequences: [{ id: 'main', trackIds: ['one'] }, { id: 'other', trackIds: ['two'] }], primarySequenceId: 'main',
	});
	const before = structuredClone(project);
	assert.equal(regularIntervalDialogDefaults(project).endFrame, primaryFrames);
	assert.deepEqual(project, before, 'default planning never changes another sequence');
	if (primaryFrames === 48_000) await assertIntervalCustody(context, project);
});


type Custody = Awaited<ReturnType<typeof createClipboardCustody>>;
function Dialog({ controller, fixture, onClose }: Readonly<{ controller: Custody['controller']; fixture: ReturnType<typeof mountControllerDataDom>; onClose(): void }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	// Validate the actual controller publication at the UI's narrower audio-only project boundary.
	const port = { project: clipboardProject(snapshot.project), actions: controller.actions };
	return React.createElement(RegularIntervalAnnotationDialog, { controller: port, snapshot, copy: ENGLISH_COPY, run: fixture.run, onClose });
}

async function assertIntervalCustody(context: import('node:test').TestContext, project: ReturnType<typeof createSoundscaperProject>) {
	const f = await createClipboardCustody(context), { controller } = f, fixture = mountControllerDataDom();
	const pcm = [new Float32Array(480_000)]; await f.open(project, new Map([['pcm', pcm]]));
	const before = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries.length;
	let closed = 0;
	try {
		await fixture.render(React.createElement(Dialog, { controller, fixture, onClose: () => { closed++; } }));
		const value = (name: string) => fixture.dom.container.querySelectorAll('input').find(node => {
			const inputName: unknown = Reflect.get(reactProps(node), 'name'); return typeof inputName === 'string' && inputName === name;
		})?.value;
		assert.equal(fixture.dom.one('[aria-label="End frame"]').querySelector('.timecode__display')?.textContent, '00h00m01.000s');
		assert.equal(value('endFrame'), '48000'); assert.equal(value('startFrame'), '0'); assert.equal(value('intervalFrames'), '48000');
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries);
		await act(async () => { reactProps(fixture.dom.one('form')).onSubmit({ preventDefault() {} }); await Promise.resolve(); await fixture.settle(); });
		assert.equal(closed, 1);
		const after = clipboardProject(controller.project), annotation = after.timelineAnnotations[0]; assert.ok(annotation);
		assert.equal(after.timelineAnnotations.length, 1);
		assert.deepEqual(annotation, { id: annotation.id, sequenceId: 'main', kind: 'marker', anchor: 'sample', positionFrame: 0,
			name: 'Cue 1', color: 'auto', batchId: annotation.batchId, opaqueExtensions: {} });
		assert.ok(typeof annotation.id === 'string' && annotation.id.length > 0); assert.ok(typeof annotation.batchId === 'string' && annotation.batchId.length > 0);
		assert.deepEqual(clipboardDocument(after), { ...clipboardDocument(before), timelineAnnotations: [annotation], featureRequirements: { schemaVersion: 2, requirements: [{
			displayName: 'Timeline markers and regions', disposition: 'bypass', fallback: null, featureId: 'org.soundscaper.capability.timeline-annotations', id: 'soundscaper.timeline-annotations',
		}] } });
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
		await act(async () => { controller.actions.edit.undo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		await act(async () => { controller.actions.edit.redo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(after));
		await fixture.render(null);
		const reopened = await f.archive((name, channels) => { assert.equal(name, project.sources[0]?.name); assertPcmChannelsEqual(channels, pcm, 'all ten seconds of original silence'); });
		assert.deepEqual(clipboardDocument(clipboardProject(reopened)), clipboardDocument(after));
	} finally { await fixture.dispose(); }
}
