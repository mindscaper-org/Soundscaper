/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LabelTrackRow } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a plain label-track header retires the prior audio selection before Delete', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: .2, channelCount: 1, durationSeconds: .2, frequency: 440 });
	controller.actions.labels.add(null, { title: 'Cue', startFrame: 0, endFrame: 1200 });
	const project = controller.project; assert.ok(project);
	const track = project.tracks.find(candidate => candidate.type === 'label'); assert.ok(track);
	const clip = project.clips[0]; assert.ok(clip);
	controller.actions.timeline.selectClip(clip.id);
	const originalClips = structuredClone(controller.project?.clips);
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<LabelTrackRow controller={controller} track={track} visualHeight={100} trackIndex={1}
			panelWidth={180} timelineWidth={600} verticalRulerWidth={40} pixelsPerSecond={100}
			sampleRate={48_000} viewportDurationFrames={48_000} timeSelection={null} rangeSelected={false}
			selected={false} blocked={false} copy={COPY} run={(operation: () => unknown) => operation()} onMenu={() => undefined} />));
		const header = dom.one('[data-track-header]'), name = dom.one('[data-track-name]');
		await act(async () => { reactProps(header).onClick?.({ target: name, currentTarget: header }); });
		assert.equal(controller.getSnapshot().selectedTrackId, track.id);
		assert.deepEqual(controller.project?.selection.trackIds, [track.id]);
		assert.deepEqual(controller.project?.selection.clipIds, []);
		controller.actions.timeline.selectClip(clip.id);
		const selectedAudio = controller.project?.selection;
		const button = dom.one('.audio-editor-label-track-actions').querySelector('button'); assert.ok(button);
		await act(async () => { reactProps(header).onClick?.({ target: button, currentTarget: header }); });
		assert.deepEqual(controller.project?.selection, selectedAudio, 'an Add label button click must retain its own label-selection authority');
		for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey']) {
			controller.actions.timeline.selectClip(clip.id);
			await act(async () => { reactProps(header).onClick?.({ target: name, currentTarget: header, [modifier]: true }); });
			assert.deepEqual(controller.project?.selection.trackIds, [project.tracks[0]!.id, track.id], modifier);
			assert.equal(controller.project?.selection.endFrame, 9600, 'modified header selection preserves the effective audio range');
		}
		await act(async () => { reactProps(header).onClick?.({ target: name, currentTarget: header }); });
		controller.actions.edit.delete();
		assert.deepEqual(controller.project?.clips, originalClips, 'Delete after selecting a label header must not delete the previously selected audio');
	} finally {
		await act(async () => root.unmount()); dom.restore();
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
