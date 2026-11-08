/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectWavBlobPcm } from '../../../../wav-import.js';
import { createWavBlobPcmChunkReader } from '../../../../wav-pcm-chunk-reader.ts';
import { dawprojectImportedAudioMimeType } from '../../../../dawproject-import-project.ts';
import { stageDawprojectCompressedSource } from '../dawproject/dawproject-import-compressed.ts';
import type { NativeProjectServiceRuntime, NativeProjectDocument, NativeProjectAudioSource } from '../../../document/native-project-types.ts';
import type { SesxServiceHelpers } from '../sesx/sesx-service.ts';
import type { TimelineInterchangeMedia } from '../../../../timeline-interchange-types.ts';
import type { TimelineInterchangeFinalizer } from './timeline-interchange-video.ts';
import type { PreparedStreamedAudioImport } from '../../../../browser-streamed-audio-import.ts';

/** Decode one source at a time and publish only after the entire project is ready. */
export async function stageTimelineInterchangeMedia(runtime: NativeProjectServiceRuntime, helpers: SesxServiceHelpers,
	operation: ReturnType<SesxServiceHelpers['beginProjectTask']>, reference: TimelineInterchangeMedia, blob: Blob, stagedIds: string[],
	finalizers: TimelineInterchangeFinalizer[] = [],
): Promise<Readonly<Record<string, unknown>> | null> {
	const signal = operation.task.signal;
	const assertCurrent = () => helpers.assertOwnership(operation.task, operation.projectToken);
	signal.throwIfAborted();
	const id = runtime.createStableId('source');
	if (reference.kind === 'video') {
		const { stageTimelineInterchangeVideo } = await import('./timeline-interchange-video.ts');
		return stageTimelineInterchangeVideo({ store: runtime.store, reference, blob, sourceId: id,
			sampleRate: Number(runtime.getProject()?.sampleRate ?? 48000), signal, assertCurrent,
			preflightStorage: async (bytes, purpose) => { await runtime.preflightStorage(bytes, purpose); }, stagedIds, finalizers });
	}
	let prepared: PreparedStreamedAudioImport | null = null;
	try {
		const wav = await inspectPcmWav(blob, signal);
		if (!wav) {
			if (!runtime.prepareDawprojectAudio) return null;
			try { prepared = await runtime.prepareDawprojectAudio(blob, reference.name, signal); }
			catch (error) {
				if (error instanceof RangeError || signal.aborted) throw error;
				assertCurrent(); return null;
			}
		}
		assertCurrent();
		const info = wav ?? prepared!.descriptor;
		const bytes = info.frameCount * info.channelCount * Float32Array.BYTES_PER_ELEMENT;
		if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new RangeError('Interchange audio has an invalid decoded size.');
		await runtime.preflightStorage(bytes, 'import');
		assertCurrent();
		const source: NativeProjectAudioSource = { kind: 'audio', id, storageKey: id, name: reference.name,
			mimeType: dawprojectImportedAudioMimeType(reference.name), sampleRate: info.sampleRate,
			frameCount: info.frameCount, channelCount: info.channelCount };
		const chunkFrames = Math.min(runtime.sourceChunkFrames, 262_144);
		if (wav) {
			const reader = createWavBlobPcmChunkReader(blob, { descriptor: wav, chunkFrames });
			const staging: NativeProjectDocument = { id: `staging-${id}`, title: 'Interchange staging', schemaVersion: 17, sources: [source], clips: [] };
			await helpers.persistSourceChunks(staging, id, (async function* () {
				for (let index = 0; index < reader.chunkCount; index++) {
					assertCurrent(); yield (await reader.readChunk(index, { signal })).channels;
				}
			})(), stagedIds, operation);
		} else if (!await stageDawprojectCompressedSource(runtime.store, prepared!, source, chunkFrames, signal, assertCurrent, stagedIds, 'timeline interchange')) return null;
		assertCurrent();
		return source as unknown as Readonly<Record<string, unknown>>;
	} finally { prepared?.dispose(); }
}

async function inspectPcmWav(blob: Blob, signal: AbortSignal) {
	const signature = String.fromCharCode(...new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
	if (!['RIFF', 'RF64', 'BW64'].includes(signature)) return null;
	try { return await inspectWavBlobPcm(blob, { signal }); }
	catch (error) { if (signal.aborted) throw error; return null; }
}
