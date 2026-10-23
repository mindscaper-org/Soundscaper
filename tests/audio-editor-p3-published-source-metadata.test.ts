/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createImportedSourceProvenance, normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { createProjectAttributionReport } from '../src/common/editor/project-attribution-report.ts';
import { presentProjectAttributionReport, saveProjectAttributionCsv } from '../src/common/editor/ui/workspace/project-attribution-presentation.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const credit of ['Third credit', { credit: 'Nested credit' }] as const) {
	test(`P3-006: File Open publishes complete imported metadata (${typeof credit})`, async context => {
		const tags = Object.fromEntries([['__proto__', credit], ['constructor', 'First credit'], ['toString', 'Second credit']]);
		const provenance = createImportedSourceProvenance({ id: 'import-credit', origin: {
			kind: 'local-file', originalFileName: 'Credits.mp3', mimeType: 'audio/mpeg',
		}, metadata: { raw: { TXXX: tags } } });
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 4, channelCount: 1, provenance });
		const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4, sourceDurationFrames: 4 });
		const project = createSoundscaperProject({ id: 'published-credit', sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: 'voice', clipIds: [clip.id] })] });
		const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
		const writer = await archiveStore.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.of(.25, -.25, .5, -.5)]); await writer.commit();
		const archive = await exportScapeProject(project, archiveStore); assert.ok(archive.blob instanceof Blob);
		await archiveStore.close();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Credits.sscape'), () => 'copy');
		assert.equal(controller.getSnapshot().readOnly, false);
		await controller.actions.project.save();
		const snapshot = controller.getSnapshot(); assert.ok(snapshot.project);
		const stored = await store.loadProject(snapshot.project.id); assert.ok(stored);
		assert.deepEqual(normalizeSourceProvenance(stored.sources[0]?.provenance).contributions[0]?.metadata.raw.TXXX, tags,
			'the admitted native archive and canonical saved metadata retain the exact legal tag');
		const publishedTags = normalizeSourceProvenance(snapshot.project.sources[0]?.provenance).contributions[0]?.metadata.raw.TXXX;
		assert.deepEqual(publishedTags, tags, 'the UI publication retains every own data key');
		assert.equal(Object.getPrototypeOf(publishedTags), Object.prototype);
		assert.ok(Object.isFrozen(publishedTags));
		const report = createProjectAttributionReport(snapshot.project);
		const presented = presentProjectAttributionReport(report);
		const field = presented.occurrences.flatMap(occurrence => occurrence.sources.flatMap(source => source.metadata))
			.find(field => field.key.startsWith('raw.TXXX.__proto__'));
		assert.equal(field?.value, typeof credit === 'string' ? credit : credit.credit);
		let csv = '';
		await saveProjectAttributionCsv(report, snapshot.project.title, { saveFile: request => { csv = request.text; return undefined; } });
		assert.ok(csv.includes(typeof credit === 'string' ? credit : credit.credit));
	});
}
