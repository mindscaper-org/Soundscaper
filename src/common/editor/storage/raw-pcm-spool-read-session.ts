/* SPDX-License-Identifier: AGPL-3.0-only */
import type { KeyValueRepository } from './key-value-repository.ts';
import type { SourceRecordRepository } from './source-record-repository.ts';
import { normalizeTimedRawPcmSpoolChunk } from './raw-pcm-spool-chunk-timing.ts';
import {
	normalizeRawPcmSpoolChunkIndex, normalizeRawPcmSpoolRecord, normalizeRawPcmSpoolRegistry,
	sameRawPcmSpoolRecord, type RawPcmSpoolRecord,
} from './raw-pcm-spool-record.ts';

type GenerationValues = Partial<Pick<KeyValueRepository, 'captureGeneration' | 'getGeneration'>>;
type Chunks = Pick<SourceRecordRepository, 'chunk'>;
export interface RawPcmSpoolReadSession {
	assertCurrent(): Promise<void>;
	chunk(index: number): Promise<ReturnType<typeof normalizeTimedRawPcmSpoolChunk>>;
}

/** Keep the public one-shot read path's exact validation and before/after ownership checks. */
export async function readRawPcmSpoolChunk(recordValue: RawPcmSpoolRecord, indexValue: number,
	chunks: Chunks, assertCurrent: (record: RawPcmSpoolRecord) => Promise<void>) {
	const record = normalizeRawPcmSpoolRecord(recordValue);
	assertReadable(record);
	const index = checkedIndex(record, indexValue);
	await assertCurrent(record);
	const chunk = normalizeTimedRawPcmSpoolChunk(await chunks.chunk(record.spoolToken, index), record, index);
	await assertCurrent(record);
	return chunk;
}

/** Immutable sealed manifest admission is separate from fresh persistent entry ownership. */
export async function createRawPcmSpoolReadSession(values: GenerationValues, chunks: Chunks,
	recordValue: RawPcmSpoolRecord, registryKey: string,
	assertFallbackCurrent: (record: RawPcmSpoolRecord) => Promise<void>): Promise<Readonly<RawPcmSpoolReadSession>> {
	const record = normalizeRawPcmSpoolRecord(recordValue);
	if (record.state !== 'sealed' || record.appendProtocol !== undefined) throw new Error('A prepared raw PCM read requires a sealed capture.');
	let generation: string | null = null;
	const assertCurrent = async (): Promise<void> => {
		if (!values.captureGeneration || !values.getGeneration) { await assertFallbackCurrent(record); return; }
		if (generation !== null && await values.getGeneration(registryKey) === generation) return;
		const captured = await values.captureGeneration(registryKey);
		if (captured.value == null) throw new Error('Raw PCM spool ownership changed.');
		const registry = normalizeRawPcmSpoolRegistry(captured.value, record.projectId);
		const current = registry.records.find(candidate => candidate.spoolId === record.spoolId);
		if (!current || !sameRawPcmSpoolRecord(current, record)) throw new Error('Raw PCM spool ownership changed.');
		// A sibling spool may change this row while this exact sealed record remains current.
		generation = captured.generation;
	};
	await assertCurrent();
	return Object.freeze({ assertCurrent, async chunk(indexValue: number) {
		const index = checkedIndex(record, indexValue);
		await assertCurrent();
		const chunk = normalizeTimedRawPcmSpoolChunk(await chunks.chunk(record.spoolToken, index), record, index);
		await assertCurrent();
		return chunk;
	} });
}

function assertReadable(record: RawPcmSpoolRecord): void {
	if (record.state === 'discarded' || record.state === 'deleting') throw new Error('Discarded raw PCM is not readable capture evidence.');
}
function checkedIndex(record: RawPcmSpoolRecord, value: number): number {
	const index = normalizeRawPcmSpoolChunkIndex(value);
	if (index >= record.chunkCount) throw new RangeError(`Raw PCM spool chunk ${String(index)} is outside its prefix.`);
	return index;
}
