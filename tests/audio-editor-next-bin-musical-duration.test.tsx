/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
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
import { createClipboardCustody, clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const anchor of ['musical', 'sample'] as const) test(`NP043: Project Bin presents the resolved ${anchor} audio duration`, async context => {
	if (anchor === 'musical') { await assertMusicalBinCustody(context); return; }
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
			sourceId: source.id, sourceDurationFrames: 48_000, anchor, timelineStartFrame: 0, durationFrames: 48_000 })] });
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Musical.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	controller.actions.projectBin.moveFromTimeline('music');
	const current: unknown = controller.project; assert.ok(validateSoundscaperProject(current));
	const clip = current.projectBin.clips[0]; assert.ok(clip);
	const markup = () => renderToStaticMarkup(<ThemeProvider><ProjectBinCard clip={clip} itemClips={[clip]} source={source} sources={[source]}
		project={controller.project} controller={controller} copy={ENGLISH_COPY} locale="en" mutationBlocked={false} missing={false}
		selectedMediaTrack={null} preview={null} run={(work: () => unknown) => work()} onOpenMenu={() => undefined} onDragEnd={() => undefined} /></ThemeProvider>);
	assert.match(markup(), /project-bin-meta"><span>0:01\.0<\/span>/u);
	controller.actions.project.setTempo(60);
	assert.match(markup(), /project-bin-meta"><span>0:01\.0<\/span>/u);
});


type Custody = Awaited<ReturnType<typeof createClipboardCustody>>;
function LiveCard({ controller, fixture }: Readonly<{ controller: Custody['controller']; fixture: ReturnType<typeof mountControllerDataDom> }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	const project = clipboardProject(snapshot.project), clip = project.projectBin.clips[0]; assert.ok(clip);
	const source = project.sources[0]; assert.ok(source?.kind === 'audio');
	return <ThemeProvider><ProjectBinCard clip={clip} itemClips={[clip]} source={source} sources={[source]}
		project={project} controller={controller} copy={ENGLISH_COPY} locale="en" mutationBlocked={false} missing={false}
		selectedMediaTrack={null} preview={null} run={fixture.run} onOpenMenu={() => undefined} onDragEnd={() => undefined} /></ThemeProvider>;
}

async function assertMusicalBinCustody(context: import('node:test').TestContext) {
	const f = await createClipboardCustody(context), { controller } = f, fixture = mountControllerDataDom();
	const source = createAudioSource({ id: 'tone', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	const pcm = [new Float32Array(48_000).fill(.25)];
	await f.open(createSoundscaperProject({ id: 'bin-musical-duration', sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['music'] })], clips: [createAudioClip({ id: 'music', title: 'Musical source',
			sourceId: source.id, sourceDurationFrames: 48_000, anchor: 'musical', musicalStartBeat: 0, musicalExtent: 'beat', musicalDurationBeats: 2 })] }), new Map([[source.id, pcm]]));
	const before = clipboardProject(controller.project), clip = before.clips[0]; assert.ok(clip?.kind === 'audio');
	const entries = controller.getSnapshot().history.undoEntries.length;
	try {
		await act(async () => { controller.actions.projectBin.moveFromTimeline('music'); });
		const moved = clipboardProject(controller.project), binClip = moved.projectBin.clips[0]; assert.ok(binClip);
		assert.deepEqual(clipboardDocument(moved), { ...clipboardDocument(before), clips: [],
			tracks: before.tracks.map(track => ({ ...track, clipIds: [] })),
			mixer: { ...before.mixer, edges: before.mixer.edges.map(edge => ({ ...edge, channelMap: [0, 1] })) },
			projectBin: { ...before.projectBin, clips: [{ ...clip, groupId: null, avLinkId: null, binItemId: 'music' }] } });
		assert.equal(binClip.durationFrames, undefined); assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
		await fixture.render(<LiveCard controller={controller} fixture={fixture} />);
		const clock = () => fixture.dom.one('.kw-audio-editor__project-bin-meta').querySelector('span')?.textContent;
		assert.equal(clock(), '0:01.0');
		await fixture.render(null);
		await act(async () => { controller.actions.edit.undo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		await act(async () => { controller.actions.edit.redo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(moved));
		await fixture.render(<LiveCard controller={controller} fixture={fixture} />);
		await act(async () => { controller.actions.project.setTempo(60); });
		assert.equal(clock(), '0:02.0');
		const final = clipboardProject(controller.project);
		assert.deepEqual(final.projectBin, moved.projectBin); assert.deepEqual(final.sources, before.sources);
		await fixture.render(null);
		const reopened = await f.archive((name, channels) => { assert.equal(name, source.name); assertPcmChannelsEqual(channels, pcm, 'every original .25 source sample'); });
		assert.deepEqual(clipboardDocument(clipboardProject(reopened)), clipboardDocument(final));
	} finally { await fixture.dispose(); }
}
