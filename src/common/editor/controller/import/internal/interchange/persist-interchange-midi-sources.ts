/* SPDX-License-Identifier: AGPL-3.0-only */

import { openMidiAudioRenderer } from '../../../../engine/midi-audio-renderer.ts';
import { AUDIO_EDITOR_PCM_CHUNK_FRAMES } from '../../../../pcm-chunks.js';
import type { TimelineInterchangeMidiSource } from '../../../../timeline-interchange-midi.ts';
import type { NativeProjectServiceRuntime, NativeProjectDocument } from '../../../document/native-project-types.ts';
import type { SesxServiceHelpers } from '../sesx/sesx-service.ts';

/** Persist recipes, or streamed PCM for stores without recipe support, before activation. */
export async function persistInterchangeMidiSources(runtime: NativeProjectServiceRuntime, helpers: SesxServiceHelpers,
	operation: ReturnType<SesxServiceHelpers['beginProjectTask']>, sources: readonly TimelineInterchangeMidiSource[], persisted: string[]) {
	const assertCurrent = () => helpers.assertOwnership(operation.task, operation.projectToken);
	const layouts = new Map<string, Readonly<{ channelCount: number; chunkFrames: number }>>();
	for (const source of sources) {
		assertCurrent();
		if (!Number.isSafeInteger(source.frameCount) || source.frameCount < 1 || source.frameCount > source.sampleRate * 86400) {
			throw new RangeError('MIDI audio must have a positive duration of at most 24 hours.');
		}
		if (runtime.store.writeMidiSource) {
			const recipe = { data: source.data, instrument: source.instrument, sampleRate: source.sampleRate };
			await runtime.preflightStorage(new TextEncoder().encode(JSON.stringify(recipe)).byteLength, 'import');
			assertCurrent();
			const stored = await runtime.store.writeMidiSource(source.sourceId, recipe, { name: 'MIDI.wav', mimeType: 'audio/wav', frameCount: source.frameCount });
			persisted.push(source.sourceId);
			layouts.set(source.sourceId, { channelCount: Number(stored.channelCount), chunkFrames: Number(stored.chunkFrames) });
			assertCurrent(); continue;
		}
		const render = await openMidiAudioRenderer(source.data, source.instrument, source.sampleRate);
		try {
			const staged: NativeProjectDocument = { id: `staging-${source.sourceId}`, title: 'MIDI staging', schemaVersion: 17, clips: [],
				sources: [{ kind: 'audio', id: source.sourceId, storageKey: source.sourceId, name: 'MIDI.wav', mimeType: 'audio/wav',
					frameCount: source.frameCount, channelCount: render.channelCount, sampleRate: source.sampleRate }] };
			const bytes = source.frameCount * render.channelCount * Float32Array.BYTES_PER_ELEMENT;
			if (!Number.isSafeInteger(bytes)) throw new RangeError('MIDI source exceeds the supported byte range.');
			await runtime.preflightStorage(bytes, 'import');
			assertCurrent();
			async function* chunks(): AsyncGenerator<readonly Float32Array[]> {
				const size = Math.min(runtime.sourceChunkFrames, AUDIO_EDITOR_PCM_CHUNK_FRAMES);
				for (let start = 0; start < source.frameCount; start += size) {
					assertCurrent(); yield await render.render(start, Math.min(size, source.frameCount - start));
				}
			}
			await helpers.persistSourceChunks(staged, source.sourceId, chunks(), persisted, operation);
			layouts.set(source.sourceId, { channelCount: render.channelCount, chunkFrames: runtime.sourceChunkFrames });
		} finally { await render.close(); }
	}
	return layouts;
}

/** Canonical sources must describe the actual persisted layout, including generated recipes. */
export function withInterchangeMidiSourceLayouts(project: Readonly<Record<string, unknown>>,
	layouts: ReadonlyMap<string, Readonly<{ channelCount: number; chunkFrames: number }>>): Record<string, unknown> {
	if (!Array.isArray(project.sources)) throw new TypeError('Interchange project sources are required.');
	return { ...project, sources: project.sources.map((source: Readonly<Record<string, unknown>>) => {
		const layout = layouts.get(String(source.id));
		return layout ? { ...source, ...layout } : source;
	}) };
}
