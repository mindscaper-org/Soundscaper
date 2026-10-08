/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAup4DatabaseAdapter } from './aup4-database-sql.js';
import { decodeAudacitySampleBlock } from './audacity-sample-block.js';
import { AUP4_IMPORT_CHUNK_FRAMES, type Aup4ImportBlock } from './aup4-import-plan.ts';

interface DatabaseAdapter { rows(sql: string, bind?: number[]): unknown[][] }
export interface RecoveredAudacityBlock {
	readonly blockId: number;
	readonly sampleFormat: number;
	readonly byteLength: number;
	readonly usableFrames: number;
	readonly unreadableRanges: readonly Readonly<{ start: number; end: number }>[];
	readonly nonFiniteSamples: number;
}

/** Probe PCM in bounded ranges before publishing a recovery loss report. */
export function inspectRecoverableAudacityBlock(database: unknown, blockId: number): RecoveredAudacityBlock | null {
	const adapter = createAup4DatabaseAdapter(database) as DatabaseAdapter;
	let row: unknown[] | undefined;
	try { row = adapter.rows('SELECT sampleformat, length(samples) FROM sampleblocks WHERE blockid = ? LIMIT 1', [blockId])[0]; }
	catch { return null; }
	if (!row) return null;
	const sampleFormat = Number(row[0]), byteLength = Number(row[1]);
	if (![0x00020001, 0x00040001, 0x0004000f].includes(sampleFormat)
		|| !Number.isSafeInteger(byteLength) || byteLength < 0) return null;
	const bytesPerSample = sampleFormat >>> 16;
	const usableFrames = Math.floor(byteLength / bytesPerSample);
	// Each pull stays bounded even for a nonstandard large block. Dropping a
	// readable block because of its size would invent audio loss during recovery.
	const unreadableRanges: Array<{ start: number; end: number }> = [];
	let nonFiniteSamples = 0;
	for (let start = 0; start < usableFrames; start += AUP4_IMPORT_CHUNK_FRAMES) {
		const end = Math.min(usableFrames, start + AUP4_IMPORT_CHUNK_FRAMES);
		try {
			const bytes = adapter.rows('SELECT substr(samples, ?, ?) FROM sampleblocks WHERE blockid = ? LIMIT 1',
				[start * bytesPerSample + 1, (end - start) * bytesPerSample, blockId])[0]?.[0];
			if (!(bytes instanceof Uint8Array) || bytes.byteLength !== (end - start) * bytesPerSample) throw new Error('Unreadable PCM range.');
			if (sampleFormat === 0x0004000f) {
				const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
				for (let offset = 0; offset < bytes.byteLength; offset += 4) {
					if (!Number.isFinite(view.getFloat32(offset, true))) nonFiniteSamples += 1;
				}
			}
		} catch { unreadableRanges.push({ start, end }); }
	}
	return { blockId, sampleFormat, byteLength, usableFrames, unreadableRanges, nonFiniteSamples };
}

/** Preserve readable prefixes and exact timing; substitute only inventoried damage. */
export function readRecoveredAudacitySamples(
	database: unknown, inventory: ReadonlyMap<number, RecoveredAudacityBlock>,
	block: Aup4ImportBlock, offset: number, frames: number,
): Float32Array {
	if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(frames) || frames < 1
		|| frames > AUP4_IMPORT_CHUNK_FRAMES || offset + frames > block.frameCount) throw new RangeError('Invalid recovered Audacity sample range.');
	const recovered = inventory.get(block.blockId);
	if (!recovered) throw new Error(`Audacity sample block ${String(block.blockId)} was not inventoried for recovery.`);
	const output = new Float32Array(frames);
	const end = Math.min(offset + frames, recovered.usableFrames);
	if (end <= offset) return output;
	const adapter = createAup4DatabaseAdapter(database) as DatabaseAdapter;
	let start = offset;
	for (const gap of [...recovered.unreadableRanges, { start: end, end }]) {
		const rangeEnd = Math.min(end, gap.start);
		if (rangeEnd > start) {
			const bytesPerSample = recovered.sampleFormat >>> 16;
			const row = adapter.rows('SELECT sampleformat, length(samples), substr(samples, ?, ?) FROM sampleblocks WHERE blockid = ? LIMIT 1',
				[start * bytesPerSample + 1, (rangeEnd - start) * bytesPerSample, block.blockId])[0];
			if (Number(row?.[0]) !== recovered.sampleFormat || Number(row?.[1]) !== recovered.byteLength
				|| !(row?.[2] instanceof Uint8Array) || row[2].byteLength !== (rangeEnd - start) * bytesPerSample) {
				throw new Error('Audacity PCM changed after recovery inspection.');
			}
			output.set(decodeAudacitySampleBlock(row[2], recovered.sampleFormat, { maxSamples: AUP4_IMPORT_CHUNK_FRAMES }), start - offset);
		}
		start = Math.max(start, gap.end);
		if (start >= end) break;
	}
	return output;
}
