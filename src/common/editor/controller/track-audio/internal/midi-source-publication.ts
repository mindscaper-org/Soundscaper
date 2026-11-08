/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMidiRenderer } from '../../../engine/midi-synthesis.ts';
import type { MidiClipData, MidiInstrument } from '../../../midi-model.ts';
import { createAudioSource } from '../../../project-media-factory.ts';
import { SOURCE_CHUNK_FRAMES } from '../../../source-pcm-contract.ts';
import { createNonImportedSourceProvenance } from '../../../source-provenance-root.ts';
import type { MidiServiceDependencies } from '../midi-service-types.ts';

/** Compile MIDI into bounded PCM blocks accepted by every maintained playback backend. */
export async function publishMidiSource(
	dependencies: MidiServiceDependencies, data: MidiClipData, instrument: MidiInstrument,
	sampleRate: number, minimumFrames: number, assertCurrent: () => void,
) {
	const interchange = data.interchange;
	const noteEnd = data.notes.reduce((end, note) => Math.max(end, note.startFrame + note.durationFrames), minimumFrames);
	const frameCount = [...interchange?.events ?? [], ...interchange?.tempos ?? [], ...interchange?.signatures ?? []]
		.reduce((end, event) => Math.max(end, event.frame + 1), noteEnd);
	if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > sampleRate * 86_400) {
		throw new RangeError('MIDI audio must have a positive duration of at most 24 hours.');
	}
	const id = dependencies.createId('midi-source');
	const metadata = { name: dependencies.clipName(), mimeType: 'audio/wav', sampleRate, channelCount: 1, chunkFrames: SOURCE_CHUNK_FRAMES };
	const writer = await dependencies.store.beginSourceWrite(id, metadata);
	try {
		assertCurrent();
		const render = createMidiRenderer(data.notes, instrument, sampleRate, interchange?.events);
		for (let start = 0; start < frameCount; start += SOURCE_CHUNK_FRAMES) {
			const samples = render(start, Math.min(SOURCE_CHUNK_FRAMES, frameCount - start));
			await writer.write([samples]);
			assertCurrent();
		}
		await writer.commit(metadata);
		assertCurrent();
		return createAudioSource({ ...metadata, id, storageKey: id, frameCount, originalSampleRate: sampleRate,
			sampleFormat: 'float32', provenance: createNonImportedSourceProvenance('generated') });
	} catch (error) {
		const cleanup = await Promise.allSettled([
			Promise.resolve().then(() => writer.abort(error)),
			Promise.resolve().then(() => dependencies.store.deleteSource(id)),
		]);
		const failures = cleanup.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason as unknown);
		if (failures.length) throw new AggregateError([error, ...failures], 'MIDI source publication failed during cleanup.', { cause: error });
		throw error;
	}
}
