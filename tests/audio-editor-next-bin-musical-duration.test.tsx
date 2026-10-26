/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import ProjectBinCard from '../src/common/editor/ui/workspace/ProjectBinCard.jsx';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioTrack, createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const anchor of ['musical', 'sample'] as const) test(`NP043: Project Bin presents the resolved ${anchor} audio duration`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const source = createAudioSource({ id: 'tone', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const project = createSoundscaperProject({ id: `bin-${anchor}`, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['music'] })], clips: [createAudioClip({ id: 'music', title: 'Musical source',
			sourceId: source.id, sourceDurationFrames: 48_000, anchor, ...(anchor === 'musical'
				? { musicalStartBeat: 0, musicalExtent: 'beat', musicalDurationBeats: 2 }
				: { timelineStartFrame: 0, durationFrames: 48_000 }) })] });
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Musical.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	controller.actions.projectBin.moveFromTimeline('music');
	const current: unknown = controller.project; assert.ok(validateSoundscaperProject(current));
	const clip = current.projectBin.clips[0]; assert.ok(clip);
	if (anchor === 'musical') assert.equal(clip.durationFrames, undefined, 'the bin retains authored beat timing');
	const markup = () => renderToStaticMarkup(<ThemeProvider><ProjectBinCard clip={clip} itemClips={[clip]} source={source} sources={[source]}
		project={controller.project} controller={controller} copy={ENGLISH_COPY} locale="en" mutationBlocked={false} missing={false}
		selectedMediaTrack={null} preview={null} run={(work: () => unknown) => work()} onOpenMenu={() => undefined} onDragEnd={() => undefined} /></ThemeProvider>);
	assert.match(markup(), /project-bin-meta"><span>0:01\.0<\/span>/u);
	controller.actions.project.setTempo(60);
	assert.match(markup(), anchor === 'musical' ? /project-bin-meta"><span>0:02\.0<\/span>/u : /project-bin-meta"><span>0:01\.0<\/span>/u);
});
