/* SPDX-License-Identifier: AGPL-3.0-only */

import { recoverAudacityProjectDatabase } from './audacity-project-recovery.ts';
import { readRecoveredAudacitySamples, type RecoveredAudacityBlock } from './audacity-project-recovery-audio.ts';
import { AudacitySqlitePageError, createAudacitySqlitePageReader, type AudacityPageSamples } from './audacity-sqlite-page-reader.ts';
import { createAup4DatabaseAdapter } from './aup4-database-sql.js';
import { addAup4CompatibilityItem } from './aup4-profile.js';
import { decodeAudacitySampleBlock } from './audacity-sample-block.js';
import { AUP4_IMPORT_CHUNK_FRAMES, type Aup4ImportBlock } from './aup4-import-plan.ts';
import { crc32 } from './wavpack/pcm.js';

interface RecoveryFile {
	readonly size: number;
	slice(start: number, end: number): Pick<Blob, 'arrayBuffer'>;
}
interface RecoveryContext {
	checkCancelled(): void;
	progress(value: number, phase: string): void;
}
interface PageBlock { readonly inventory: RecoveredAudacityBlock; readonly checksum: number; readonly readableBytes: number }

/** The ordinary recovery import: retain readable SQL ranges, then try live page chains. */
export async function recoverAudacityProjectWithPages(database: unknown, file: RecoveryFile,
	context: RecoveryContext = { checkCancelled() {}, progress() {} },
) {
	context.checkCancelled();
	let validation = recoverAudacityProjectDatabase(database);
	const damaged = new Set(validation.compatibilityReport.items.filter(item => item.code === 'RECOVERED_AUDIO_SILENCE')
		.map(item => Number(item.data.blockId)).filter(id => id > 0));
	const pages = new Map<number, PageBlock>();
	let raw: Awaited<ReturnType<typeof createAudacitySqlitePageReader>> | undefined;
	let cached: { blockId: number; block: AudacityPageSamples } | undefined;
	if (damaged.size) {
		context.progress(0, 'recovering');
		const adapter = createAup4DatabaseAdapter(database) as { value(sql: string): unknown };
		const root = Number(adapter.value("SELECT rootpage FROM sqlite_schema WHERE name='sampleblocks' AND type='table'"));
		try {
			raw = await createAudacitySqlitePageReader({ byteLength: file.size, async read(offset, length) {
				context.checkCancelled();
				const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
				context.checkCancelled();
				return bytes;
			} }, root);
		} catch (error) {
			// A damaged freelist cannot authorize deleted audio. Preserve SQL-only
			// recovery; cancellation, changed-source and storage failures stay errors.
			if (!(error instanceof AudacitySqlitePageError)) throw error;
		}
		let completed = 0;
		for (const blockId of damaged) {
			context.checkCancelled();
			const existing = validation.audio.get(blockId);
			if (raw && (!existing || existing.unreadableRanges.length)) {
				const block = await raw.readSampleBlock(blockId);
				const inventory = block ? inspectPageBlock(blockId, block) : null;
				// Never discard surviving SQL ranges to substitute a raw-page prefix.
				const sqlFrames = existing ? existing.usableFrames - existing.unreadableRanges.reduce((sum, gap) => sum + gap.end - gap.start, 0) : 0;
				if (block && inventory && sqlFrames === 0) {
					pages.set(blockId, { inventory, checksum: crc32(block.samples), readableBytes: block.readableBytes });
					cached = { blockId, block };
				}
			}
			context.progress(++completed / damaged.size, 'recovering');
		}
	}
	if (pages.size) {
		const inventories = new Map(validation.audio);
		for (const [id, page] of pages) inventories.set(id, page.inventory);
		validation = recoverAudacityProjectDatabase(database, inventories);
		addAup4CompatibilityItem(validation.compatibilityReport, { code: 'RECOVERED_SQLITE_PAGE_AUDIO', severity: 'warning', disposition: 'converted',
			scope: { kind: 'project' }, data: { blocks: pages.size },
			message: `Readable audio prefixes in ${String(pages.size)} damaged SQLite blocks were recovered from live database pages. Unreadable tails remain silence; the original file is unchanged.` });
	}
	context.checkCancelled();
	return { validation, readSamples };

	async function readSamples(block: Aup4ImportBlock, offset: number, frames: number): Promise<Float32Array> {
		context.checkCancelled();
		const page = pages.get(block.blockId);
		if (!page) return readRecoveredAudacitySamples(database, validation.audio, block, offset, frames);
		if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(frames) || frames < 1
			|| frames > AUP4_IMPORT_CHUNK_FRAMES || offset + frames > block.frameCount) throw new RangeError('Invalid recovered Audacity sample range.');
		const bytes = cached?.blockId === block.blockId ? cached.block : await raw!.readSampleBlock(block.blockId);
		context.checkCancelled();
		if (!bytes || bytes.sampleFormat !== page.inventory.sampleFormat || bytes.samples.byteLength !== page.inventory.byteLength
			|| bytes.readableBytes !== page.readableBytes || crc32(bytes.samples) !== page.checksum) throw new Error('Audacity PCM changed after recovery inspection.');
		cached = { blockId: block.blockId, block: bytes };
		const output = new Float32Array(frames), width = bytes.sampleFormat >>> 16;
		const end = Math.min(offset + frames, bytes.readableBytes / width);
		if (end > offset) output.set(decodeAudacitySampleBlock(bytes.samples.subarray(offset * width, end * width),
			bytes.sampleFormat, { maxSamples: AUP4_IMPORT_CHUNK_FRAMES }));
		return output;
	}
}

function inspectPageBlock(blockId: number, block: AudacityPageSamples): RecoveredAudacityBlock | null {
	if (!block.readableBytes) return null;
	const width = block.sampleFormat >>> 16, usableFrames = block.samples.byteLength / width, prefix = block.readableBytes / width;
	let nonFiniteSamples = 0;
	if (block.sampleFormat === 0x0004000f) {
		const view = new DataView(block.samples.buffer, block.samples.byteOffset, block.readableBytes);
		for (let offset = 0; offset < block.readableBytes; offset += 4) if (!Number.isFinite(view.getFloat32(offset, true))) nonFiniteSamples++;
	}
	return { blockId, sampleFormat: block.sampleFormat, byteLength: block.samples.byteLength, usableFrames, nonFiniteSamples,
		unreadableRanges: prefix < usableFrames ? [{ start: prefix, end: usableFrames }] : [] };
}
