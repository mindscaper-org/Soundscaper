/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { attachExternalMedia, externalMediaForSource } from '../src/common/editor/desktop-external-media.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryClipTimePitchCache, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const authenticated of [false, true]) for (const edit of ['none', 'pencil', 'render'] as const) test(`desktop native Save retains edited samples with authenticated original=${String(authenticated)} and edit=${edit}`, async context => {
	const seed = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}-seed` });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}-working` });
	const fresh = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}-fresh` });
	const pcm = Float32Array.from({ length: 4800 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 330 * frame / 48_000));
	const wav = Uint8Array.from(encodeWav([pcm], { sampleRate: 48_000, float: true }));
	const original = new Blob([wav], { type: 'audio/wav' });
	const rawSource = createAudioSource({ id: 'original', name: 'Original.wav', frameCount: pcm.length, sampleRate: 48_000, channelCount: 1 });
	const packet = new Uint8Array(4 + pcm.byteLength); new DataView(packet.buffer).setUint32(0, pcm.length, true); packet.set(new Uint8Array(pcm.buffer), 4);
	const source = attachExternalMedia(authenticated ? { ...rawSource, contentSha256: digestScapeBytes(packet) } : rawSource,
		{ reference: 'selected-desktop-original', byteLength: original.size, sha256: digestScapeBytes(wav) }, 'audio');
	const writer = await seed.beginSourceWrite(source.storageKey, source); await writer.write([pcm]); await writer.commit();
	const project = createSoundscaperProject({ id: 'external-pencil', sources: [source], clips: [createAudioClip({
		id: 'clip', sourceId: source.id, sourceDurationFrames: pcm.length, durationFrames: pcm.length, ...(edit === 'render' ? { pitchCents: 1200 } : {}),
	})], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const archive = await exportScapeProject(project, seed, { externalMedia: true }); assert.ok(archive.blob);
	assert.equal(archive.manifest.assets[0]?.encoding, 'external-file-v1');
	const runtime = createSoundscaperProjectRuntimeSelection();
	const fileService = { ...createAudioEditorFileService({ bridge: null }), isDesktop: true,
		externalMediaResolver: () => async () => original };
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store, fileService: fileService as unknown as Options['fileService'],
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(), projectRuntime: runtime, sessionController: runtime.createSessionController(),
		// Substitute only native-worker output; archive import, immutable publication and desktop Save remain real.
		clipTimePitchCache: createMemoryClipTimePitchCache() as unknown as Options['clipTimePitchCache'],
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); await seed.close(); await fresh.close(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'External.sscape'), () => 'copy');
	assert.equal(controller.project?.sources[0]?.contentSha256, authenticated ? digestScapeBytes(packet) : undefined);
	const before = controller.project; assert.ok(before);
	if (edit === 'pencil') {
		controller.actions.timeline.selectClip('clip'); controller.actions.timeline.setZoom(288_000);
		assert.equal(controller.getSnapshot().sampleEdit.available, true);
		await controller.actions.sampleEdit.pencil({ clipId: 'clip', channel: 0, points: [{ timelineFrame: 1, value: .75 }] });
	}
	if (edit === 'render') await controller.actions.clip.renderPitchSpeed('clip');
	const result = controller.project; assert.ok(result);
	const active = result.sources.find(item => item.id === result.clips[0]?.sourceId); assert.ok(active);
	const edited = (await store.readSourceChunk(String(active.storageKey), 0))?.channels[0]; assert.ok(edited);
	if (edit === 'pencil') assert.equal(edited[1], .75);
	if (edit !== 'none') assert.ok(edited.some((value, frame) => Math.abs(value - pcm[frame]!) > .01), 'the public edit must change physical PCM');
	const saved = await exportScapeProject(result, store, { externalMedia: true }); assert.ok(saved.blob);
	assert.equal(saved.manifest.assets.find(asset => asset.sourceId === active.id)?.encoding, edit === 'none' ? 'external-file-v1' : 'audio-f32le-chunks-v1');
	if (edit !== 'none') {
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
		assert.equal(externalMediaForSource(controller.project?.sources.find(item => item.id === before.clips[0]?.sourceId))?.reference, 'selected-desktop-original');
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, result.clips);
	}
	const reopened = await createSoundscaperScapeNativeRuntime().importScapeProject(saved.blob, fresh, { resolveExternalMedia: async () => original });
	const reopenedProject: unknown = reopened.project; assert.ok(validateSoundscaperProject(reopenedProject));
	const reopenedSource = reopenedProject.sources.find(item => item.id === reopenedProject.clips[0]?.sourceId); assert.ok(reopenedSource);
	assertPcmSamplesEqual((await fresh.readSourceChunk(String(reopenedSource.storageKey), 0))?.channels[0], edited,
		'the desktop project must restore the edited PCM rather than its imported original');
});
