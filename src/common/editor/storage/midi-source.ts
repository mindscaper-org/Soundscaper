/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMidiClipData, normalizeMidiTrackData, type MidiClipData, type MidiInstrument } from '../midi-model.ts';
import { openMidiInstrumentSession } from '../engine/midi-audio-renderer.ts';
import type { StorageRecord } from './media-records.ts';
import type { SourceRecordRepository } from './source-record-repository.ts';
import { createId, PENDING_SOURCE_RETENTION_MS } from './source-write-common.ts';

export const MIDI_SOURCE_STORAGE = 'midi-generated-v1';
export const MIDI_SOURCE_CHUNK_FRAMES = 1024;
export interface MidiSourceRecipe { readonly data: MidiClipData; readonly instrument: MidiInstrument; readonly sampleRate: number }

export function isGeneratedMidiSource(value: unknown): value is StorageRecord & { readonly midiRecipe: MidiSourceRecipe } {
	return value !== null && typeof value === 'object' && 'storage' in value && value.storage === MIDI_SOURCE_STORAGE;
}

/** Publish the durable score and instrument identity without synthesizing the source. */
export async function publishMidiRecipe(records: Pick<SourceRecordRepository, 'putMetadataIfAbsent'>,
	id: string, recipe: MidiSourceRecipe, metadata: Readonly<Record<string, unknown>>): Promise<StorageRecord> {
	const data = normalizeMidiClipData(recipe.data), instrument = normalizeMidiTrackData({ version: 1, instrument: recipe.instrument }).instrument;
	const { sampleRate } = recipe, frameCount = Number(metadata.frameCount);
	if (!id || !Number.isSafeInteger(sampleRate) || sampleRate < 1 || !Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > sampleRate * 86400) throw new RangeError('Invalid MIDI source geometry.');
	let channelCount = instrument === 'libadlmidi' || instrument === 'fluidsynth' ? 2 : 1;
	if (typeof instrument !== 'string') {
		const renderer = await openMidiInstrumentSession(instrument, sampleRate);
		try { channelCount = renderer.channelCount; } finally { await renderer.close(); }
	}
	const record: StorageRecord = {
		...metadata, id, sampleRate, frameCount, frameLength: frameCount, channelCount,
		storage: MIDI_SOURCE_STORAGE, sourceToken: createId('midi'),
		midiRecipe: { data, instrument, sampleRate }, chunkFrames: MIDI_SOURCE_CHUNK_FRAMES,
		chunkCount: Math.ceil(frameCount / MIDI_SOURCE_CHUNK_FRAMES), storedBytes: 0, uncompressedBytes: frameCount * channelCount * 4,
		committedAt: new Date().toISOString(), pendingProjectUntil: new Date(Date.now() + PENDING_SOURCE_RETENTION_MS).toISOString(),
	};
	if (!await records.putMetadataIfAbsent(record)) throw new Error('MIDI source identity is already published.');
	return record;
}
