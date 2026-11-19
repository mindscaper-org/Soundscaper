/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import { AccessibleSelectionToolbar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { projectDurationFrames } from '../src/common/editor/project.js';
import { COPY } from './helpers/audio-editor-controller-harness.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createClipboardCustody, clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertEditedAudioArchiveCustody } from './helpers/edited-audio-archive-custody.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';

type Controller = Awaited<ReturnType<typeof createClipboardCustody>>['controller'];
type Fixture = ReturnType<typeof mountControllerDataDom>;

function Manager({ controller, fixture, projected }: Readonly<{ controller: Controller; fixture: Fixture; projected: boolean }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	const project = clipboardProject(snapshot.project);
	return <>
		<div data-musical-manager><WorkspacePanelContent panelId="labels" controller={controller}
			snapshot={snapshot} runtimeProject={projected ? projectForRuntimeConsumers(project) : null}
			copy={{ ...COPY, ...ENGLISH_COPY, select: 'Time selection' }} locale="en" run={fixture.run} fileService={null}
			playbackMeterSettings={null} showArmControls={false} displayAudioSupported={false}
			onOpenEffects={() => assert.fail('Label selection must not open effects.')} effectsPanelTarget={null}
			onEffectWindowChange={() => assert.fail('Labels have no effect window.')} blocked={false} /></div>
		<div data-musical-selection><AccessibleSelectionToolbar controller={controller} snapshot={snapshot} copy={ENGLISH_COPY}
			statusMessage="Ready" statusState="success" durationFrames={projectDurationFrames(project)} disabled={false}
			showSelectionToolbar showStatusbar={false} run={fixture.run} /></div>
	</>;
}

for (const projected of [false, true]) test(`Manage labels resolves authored musical bounds; supplied projection=${projected}`, async context => {
	const session = await createClipboardCustody(context), { controller, store } = session;
	const original = createSoundscaperProject({ id: 'musical-manager-file', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [
			{ id: 'head', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'change', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
		] }, tracks: [{ id: 'labels', type: 'label', name: 'Cues', labels: [
			{ id: 'span', title: 'Across change', anchor: 'musical', startBeat: { num: 3, den: 1 }, endBeat: { num: 5, den: 1 } },
		] }] });
	await session.open(original, new Map());
	const before = clipboardProject(controller.project), history = structuredClone(controller.getSnapshot().history);
	assert.deepEqual(clipboardDocument(before), clipboardDocument(original), 'the exact musical document survives actual Scape admission');
	const fixture = mountControllerDataDom();
	const priorObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	try {
		await fixture.render(<Manager controller={controller} fixture={fixture} projected={projected} />);
		const row = fixture.dom.one('[data-label-id="span"]'), times = row.querySelectorAll('.timecode__display');
		assert.deepEqual(times.map(time => time.textContent), ['00h00m01.500s', '00h00m03.000s']);
		const select = row.querySelectorAll('button').find(button => button.textContent === 'Time selection'); assert.ok(select);
		await act(async () => { reactProps(select).onClick(); await fixture.settle(); });
		assert.deepEqual([controller.project?.selection.startFrame, controller.project?.selection.endFrame], [72_000, 144_000]);
		const toolbar = fixture.dom.one('[data-musical-selection]');
		const displays = toolbar.querySelectorAll('.timecode__display').map(time => time.textContent);
		assert.deepEqual(displays.slice(0, 2), ['00h00m01.500s', '00h00m03.000s'], 'the actual subscribed Selection toolbar follows the Manager callback');
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		assert.deepEqual(controller.getSnapshot().history, history, 'range inspection never authors a history entry');
		await act(async () => { await controller.actions.project.flush(); });
		const persisted = clipboardProject(await store.loadProject(before.id));
		assert.deepEqual(clipboardDocument(persisted), clipboardDocument(original), 'transient range selection preserves the entire durable musical document');
		if (!projected) {
			const reopened = await assertEditedAudioArchiveCustody(context, store, persisted, []);
			assert.deepEqual(clipboardDocument(reopened), clipboardDocument(original));
		}
	} finally {
		try { await fixture.dispose(); } finally {
			if (priorObserver) Object.defineProperty(globalThis, 'MutationObserver', priorObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
		}
	}
});
