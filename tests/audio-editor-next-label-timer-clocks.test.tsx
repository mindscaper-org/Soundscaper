/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import TimedRecordingDialogFields from '../src/common/editor/ui/dialogs/TimedRecordingDialogFields.tsx';
import type { TimedRecordingDialogValue } from '../src/common/editor/ui/dialogs/timed-recording-dialog-model.ts';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import { RECORDING_COPY_BY_LOCALE } from '../src/common/i18n/recording-copy.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { COPY } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps, type ReactTestDom, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const format of ['frames', 'samples'] as const) test(`timed recording uses its project ${format} clock`, async () => {
	let value: TimedRecordingDialogValue = { startTime: '2030-10-22T12:00', endTime: '2030-10-22T12:01', durationSeconds: 3, endMode: 'duration' };
	await withDom(async (dom, root) => {
		await act(async () => root.render(<TimedRecordingDialogFields project={{ sampleRate: 44_100,
			sequences: [{ id: 'main', rate: { num: 60, den: 1 } }], primarySequenceId: 'main' }} value={value}
			onValueChange={next => { value = next; }} onSubmit={() => undefined} copy={RECORDING_COPY_BY_LOCALE.en} locale="en" />));
		await enter(dom, dom.one('.timecode'), format, format === 'frames' ? '00:00:02:01' : '88200');
		assert.equal(value.durationSeconds, format === 'frames' ? 2 + 1 / 60 : 2);
	});
});

test('Manage labels keeps optional frame entry on its foldered owning sequence', async () => {
	let history = createSoundscaperProjectHistory(createSoundscaperProject({ id: 'label-clock', sampleRate: 48_000,
		tracks: [{ id: 'labels', type: 'label', name: 'Cues', labels: [{ id: 'cue', title: 'Speech', startFrame: 0, endFrame: 144_000 }] }],
		trackFolders: [{ id: 'folder', name: 'Delivery' }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: [] }, { id: 'cut', rate: { num: 120, den: 1 }, trackNodes: [
			{ kind: 'folder', id: 'folder', parentFolderId: null }, { kind: 'track', id: 'labels', parentFolderId: 'folder' },
		] }], primarySequenceId: 'main' }));
	const controller = { actions: { labels: { update(trackId: string, labelId: string, changes: Readonly<Record<string, unknown>>) {
		history = executeSoundscaperProjectCommand(history, { type: 'label/update', trackId, labelId, changes });
	}, remove() {} }, timeline: { setExactSelection() {} } } };
	await withDom(async (dom, root) => {
		await act(async () => root.render(<WorkspacePanelContent panelId="labels" controller={controller}
			snapshot={{ project: history.present, selectedTrackId: 'labels', readOnly: false }} runtimeProject={null}
			copy={COPY} locale="en" run={(operation: () => unknown) => operation()} fileService={null} playbackMeterSettings={null}
			showArmControls={false} displayAudioSupported={false} onOpenEffects={() => undefined} effectsPanelTarget={null}
			onEffectWindowChange={() => undefined} blocked={false} />));
		const end = dom.container.querySelectorAll('.timecode')[1]; assert.ok(end);
		await enter(dom, end, 'frames', '00:00:02:01');
		const track = history.present.tracks.find(track => track.id === 'labels'); assert.ok(track && Array.isArray(track.labels));
		const label: unknown = track.labels[0]; assert.ok(label && typeof label === 'object' && 'endFrame' in label);
		assert.equal(label.endFrame, 96_400);
	});
});

async function enter(dom: ReactTestDom, field: ReactTestElement, format: 'frames' | 'samples', value: string): Promise<void> {
	const button = field.querySelector('.timecode__format-button'); assert.ok(button);
	await act(async () => { reactProps(button).onClick?.(); });
	if (format === 'frames') {
		const video = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent.startsWith('Video frames')); assert.ok(video);
		await act(async () => { reactProps(video).onClick?.({ stopPropagation() {} }); });
	}
	const item = dom.container.querySelectorAll('[role="menuitem"]').find(item => format === 'frames'
		? item.textContent.startsWith('hh:mm:ss + frames') : item.textContent === 'samples'); assert.ok(item);
	await act(async () => { reactProps(item).onClick?.({ stopPropagation() {} }); });
	const display = field.querySelector('.timecode__display'); assert.ok(display);
	await act(async () => { reactProps(display).onDoubleClick?.({}); });
	const input = field.querySelector('.timecode__free-text'); assert.ok(input);
	await act(async () => { reactProps(input).onChange?.({ currentTarget: { value } }); });
	await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); });
}

async function withDom(operation: (dom: ReactTestDom, root: Root) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try { await operation(dom, root); } finally {
		await act(async () => root.unmount()); dom.restore(); globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
	}
}
