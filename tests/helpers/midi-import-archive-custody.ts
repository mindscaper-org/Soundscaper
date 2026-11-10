/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createAudioEditorFileService } from '../../src/common/editor/file-service.js';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import type { SoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import type { AudioSourceLeaf } from '../../src/common/editor/project-media-types.ts';
import { readMidiClip } from '../../src/common/editor/midi-model.ts';
import { importSoundscaperAudacityProject } from '../../src/soundscaper/editor-audacity-project-import.ts';
import { decodeAuBlockFile } from '../../src/common/editor/aup-legacy.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';
import { readPcm } from './project-store-pcm-fixture.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
type FileRequest = Readonly<{ suggestedName?: string; bytes?: Uint8Array | ArrayBuffer; text?: string; blob?: Blob }>;
type PcmExpectation = 'audible' | 'silent' | Readonly<{ assertSamples(channels: readonly (readonly number[])[]): void }>;
interface CustodyOptions {
	/** A fixture may author an intentionally silent note or retain an older synthesized source after editing. */
	readonly sourcePcmExpectation?: (source: AudioSourceLeaf, project: SoundscaperProject) => PcmExpectation;
	/** Decode selected reviewed legacy blocks with the shipping AU owner, never a native decoder stub. */
	readonly legacyAuImport?: boolean;
}

/** Real MIDI parsing, synthesis, controller publication and portable storage. */
export async function midiImportArchiveCustody(context: TestContext, options: CustodyOptions = {}) {
	const saved: FileRequest[] = [];
	const sender = await open();
	return { ...sender, saved, async reopen() {
		const project = sender.controller.project;
		assert.ok(validateSoundscaperProject(project));
		await sender.controller.actions.project.flush();
		const originalPcm = new Map<string, number[][]>();
		for (const source of project.sources) {
			assert.ok(source.kind === 'audio');
			originalPcm.set(source.id, await readPcm(sender.store, source.storageKey));
		}
		const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, sender.store);
		assert.ok(archive.blob);
		await sender.controller.dispose();
		const recipient = await open();
		await recipient.controller.actions.project.openScapeFile(new File([archive.blob], 'Notes.sscape'), () => 'copy');
		assert.equal(recipient.controller.getSnapshot().readOnly, false);
		const restored = recipient.controller.project;
		assert.ok(validateSoundscaperProject(restored));
		assert.equal(restored.sources.length, project.sources.length);
		assert.deepEqual(restored.sources, project.sources);
		assert.deepEqual(restored.clips, project.clips);
		assert.deepEqual(restored.tracks, project.tracks);
		assert.deepEqual(restored.tempo, project.tempo);
		for (const source of restored.sources) {
			assert.ok(source.kind === 'audio');
			const expected = originalPcm.get(source.id); assert.ok(expected);
			const samples = await readPcm(recipient.store, source.storageKey);
			assert.equal(samples[0]?.length, source.frameCount);
			assertPcmChannelsEqual(samples, expected, 'synthesized MIDI archive');
			const authored = restored.clips.some(clip => clip.sourceId === source.id && (readMidiClip(clip)?.notes.length ?? 0) > 0);
			const emptyLane = restored.clips.some(clip => clip.sourceId === source.id && readMidiClip(clip)?.notes.length === 0);
			const expectation = options.sourcePcmExpectation?.(source, restored) ?? (authored ? 'audible' : 'silent');
			if (emptyLane || expectation === 'silent') assert.ok(samples.every(channel => channel.every(value => value === 0)), 'empty lanes and explicitly silent fixtures retain every zero PCM sample');
			else if (expectation === 'audible') assert.ok(samples.some(channel => channel.some(value => Math.abs(value) > .01)), 'real synthesis must publish audible PCM');
			else expectation.assertSamples(samples);
		}
		return { ...recipient, project: restored };
	} };

	async function open() {
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		let sourceWrites = 0;
		const beginSourceWrite = store.beginSourceWrite.bind(store);
		store.beginSourceWrite = (sourceId: string, metadata: Readonly<Record<string, unknown>> = {}) => {
			sourceWrites++;
			return beginSourceWrite(sourceId, metadata);
		};
		const service = createAudioEditorFileService();
		const engine = createMemoryEngine();
		const codec = { ...createMemoryFfmpeg(), ...(options.legacyAuImport ? { decode: async (file: File) => ({
			channels: [decodeAuBlockFile(new Uint8Array(await file.arrayBuffer()))], sampleRate: 48_000,
		}) } : {}) };
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			...(options.legacyAuImport ? { adaptAudacityProject: importSoundscaperAudacityProject } : {}),
			engine: (options.legacyAuImport ? { ...engine, decodeAudioData: async () => {
				throw new DOMException('Native decoders are unavailable in Node', 'NotSupportedError');
			} } : engine) as unknown as Options['engine'],
			engineFactory: () => assert.fail('MIDI synthesis must not use a substitute audio renderer'),
			ffmpeg: codec as unknown as Options['ffmpeg'],
			fileService: { ...service, saveFile: async (request: FileRequest = {}) => {
				saved.push(request); return { method: 'node-fixture', fileName: request.suggestedName ?? 'Notes.mid',
					size: request.bytes?.byteLength ?? request.blob?.size ?? new TextEncoder().encode(request.text ?? '').length };
			} },
		});
		context.after(async () => { try { await controller.dispose(); } finally { await store.close(); } });
		await controller.ready;
		return { controller, store, sourceWriteCount: () => sourceWrites };
	}
}
