/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, fsyncSync, linkSync, mkdtempSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { audacityXmlAttribute, audacityXmlChildren, decodeAudacityBinaryXml } from '../src/common/editor/audacity-binary-xml.js';
import { decodeAudacitySampleBlock } from '../src/common/editor/audacity-sample-block.js';
import { recoverAudacityProjectDatabase } from '../src/common/editor/audacity-project-recovery.ts';
import { validateAup4References } from '../src/common/editor/aup4-database-validation.js';
import { createAup4SampleBlock } from '../src/common/editor/aup4-sample-block.js';
import { AUP3_APPLICATION_ID, AUP3_MAX_BLOCK_SAMPLES, AUP3_PAGE_SIZE, AUP3_SCHEMA_SQL, AUP3_USER_VERSION } from '../src/common/editor/aup3-profile.ts';
import { createAudacitySqlitePageReader, type AudacityPageSamples } from './audacity-sqlite-page-reader.ts';

type XmlNode = Parameters<typeof audacityXmlAttribute>[0];
const attribute = audacityXmlAttribute as (node: XmlNode, name: string, fallback?: unknown) => unknown;
const children = audacityXmlChildren as unknown as (node: XmlNode, name?: string) => XmlNode[];
interface RepairLocation {
	readonly trackName: string;
	readonly clipName: string;
	readonly clipOffsetSeconds: number;
	readonly sampleRate: number;
	readonly startFrame: number;
}
interface Reference { readonly blockId: number; frames: number; readonly sampleFormat: number; readonly locations: RepairLocation[] }
export interface AudacityRepairLoss {
	readonly blockId: number;
	readonly preservedFrames: number;
	readonly silentFrames: number;
	readonly nonFiniteSamples: number;
	readonly locations: readonly RepairLocation[];
}
export interface AudacityFileRepairReport {
	readonly sourceSha256: string;
	readonly documentSource: string;
	readonly blocks: number;
	readonly losses: readonly AudacityRepairLoss[];
	readonly sourceIssues: readonly unknown[];
	readonly integrityCheck: 'ok';
	readonly journalMode: 'wal';
}

/** Rebuild into a new native SQLite file, one bounded audio block at a time. */
export function repairAudacityProjectFile(
	sourcePath: string, outputPath: string,
	onProgress: (completed: number, total: number) => void = () => undefined,
): AudacityFileRepairReport {
	const source = resolve(sourcePath), output = resolve(outputPath);
	if (source === output || existsSync(output)) throw new Error('The output must be a new file; never replace the original or an existing recovery.');
	assertNoJournal(source);
	const fd = openSync(source, 'r');
	const before = fstatSync(fd, { bigint: true });
	const uri = pathToFileURL(source); uri.search = '?mode=ro&immutable=1';
	let reader: DatabaseSync | undefined, writer: DatabaseSync | undefined, staging: string | undefined;
	try {
		reader = new DatabaseSync(uri.href, { readOnly: true, defensive: true });
		reader.exec('PRAGMA trusted_schema=OFF; PRAGMA cache_size=-16384; PRAGMA query_only=ON');
		const application = reader.prepare('PRAGMA application_id').get()?.application_id;
		const version = Number(reader.prepare('PRAGMA user_version').get()?.user_version);
		if (application !== AUP3_APPLICATION_ID || version < 0 || version > AUP3_USER_VERSION) throw new Error('Offline repair supports AUP3 databases through the pinned Audacity 3 profile.');
		const inspected = recoverAudacityProjectDatabase(sqliteFacade(reader));
		if (!['project', 'autosave'].includes(inspected.source)) throw new Error('No readable AUP3 saved document or autosave.');
		const row = reader.prepare(`SELECT dict, doc FROM ${inspected.source === 'autosave' ? 'autosave' : 'project'} WHERE id=1`).get();
		if (!(row?.dict instanceof Uint8Array) || !(row.doc instanceof Uint8Array)) throw new Error('The saved document is unreadable.');
		const document = decodeAudacityBinaryXml(row.dict, row.doc);
		const references = collectReferences(document.root);
		const raw = createAudacitySqlitePageReader({ byteLength: Number(before.size), read(offset, length) {
			const bytes = new Uint8Array(length);
			if (readSync(fd, bytes, 0, length, offset) !== length) throw new Error('The source was truncated during recovery.');
			return bytes;
		} }, Number(reader.prepare("SELECT rootpage FROM sqlite_schema WHERE name='sampleblocks' AND type='table'").get()?.rootpage));
		staging = mkdtempSync(join(dirname(output), '.scape-aup3-repair-'));
		const stagedFile = join(staging, 'repaired.aup3');
		writer = new DatabaseSync(stagedFile, { defensive: true });
		writer.exec(`PRAGMA page_size=${AUP3_PAGE_SIZE}; PRAGMA cache_size=-16384; ${AUP3_SCHEMA_SQL}`);
		writer.exec('BEGIN IMMEDIATE');
		writer.prepare('INSERT INTO project(id,dict,doc) VALUES(1,?,?)').run(row.dict, row.doc);
		const insert = writer.prepare('INSERT INTO sampleblocks(blockid,sampleformat,summin,summax,sumrms,summary256,summary64k,samples) VALUES(?,?,?,?,?,?,?,?)');
		const losses: AudacityRepairLoss[] = [];
		let completed = 0;
		for (const reference of references.values()) {
			const block = raw.readSampleBlock(reference.blockId);
			const rebuilt = rebuildBlock(reference, block);
			const summary = createAup4SampleBlock(rebuilt.decoded);
			insert.run(reference.blockId, rebuilt.format, summary.summin, summary.summax, summary.sumrms,
				summary.summary256, summary.summary64k, rebuilt.bytes);
			if (rebuilt.loss.silentFrames) losses.push(rebuilt.loss);
			onProgress(++completed, references.size);
		}
		writer.exec('COMMIT');
		const integrity = writer.prepare('PRAGMA integrity_check').all();
		if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') throw new Error('Rebuilt SQLite integrity check failed.');
		validateAup4References(sqliteFacade(writer), document.root, { includeNestedWaveClips: true, allowMissingSampleBlocks: false });
		// Audacity holds a reader before opening its writer/checkpoint connections.
		// Publish an already checkpointed WAL image so that handshake needs no
		// exclusive DELETE-to-WAL transition while the reader is active.
		if (writer.prepare('PRAGMA journal_mode=WAL').all()[0]?.journal_mode !== 'wal') throw new Error('Unable to prepare Audacity WAL publication.');
		writer.close(); writer = undefined;
		assertNoJournal(stagedFile);
		const stagedFd = openSync(stagedFile, 'r');
		try { fsyncSync(stagedFd); } finally { closeSync(stagedFd); }
		const sourceSha256 = hashFile(fd, Number(before.size));
		const after = statSync(source, { bigint: true });
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
			|| before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error('The source changed during recovery; no output was published.');
		assertNoJournal(source);
		// Same-directory staging allows atomic, exclusive publication, including on NTFS.
		linkSync(stagedFile, output);
		return { sourceSha256, documentSource: inspected.source, blocks: references.size, losses,
			sourceIssues: inspected.issues.filter(issue => issue.code !== 'RECOVERED_AUDIO_SILENCE'), integrityCheck: 'ok', journalMode: 'wal' };
	} finally {
		writer?.close(); reader?.close(); closeSync(fd);
		if (staging) rmSync(staging, { recursive: true, force: true });
	}
}

function collectReferences(root: XmlNode): Map<number, Reference> {
	const references = new Map<number, Reference>();
	let count = 0;
	function visit(node: XmlNode, context: Omit<RepairLocation, 'startFrame'>): void {
		if (node.name === 'wavetrack') context = { ...context, trackName: String(attribute(node, 'name', 'Audio')),
			sampleRate: Number(attribute(node, 'rate', context.sampleRate)) };
		if (node.name === 'waveclip') context = { ...context, clipName: String(attribute(node, 'name', 'Audio')),
			clipOffsetSeconds: Number(attribute(node, 'offset', 0)) };
		if (node.name === 'sequence') {
			const frames = integer(attribute(node, 'numsamples', 0), 0);
			const sampleFormat = Number(attribute(node, 'sampleformat', 0));
			const blocks = children(node, 'waveblock');
			if (frames && !blocks.length) throw new Error('Sequence length cannot be reconstructed.');
			for (const [index, block] of blocks.entries()) {
				if (++count > 1_000_000) throw new Error('Audacity recovery reference budget exceeded.');
				const start = integer(attribute(block, 'start', 0), 0);
				const end = index + 1 < blocks.length ? integer(attribute(blocks[index + 1], 'start', 0), 0) : frames;
				const blockId = integer(attribute(block, 'blockid', 0), Number.MIN_SAFE_INTEGER);
				if ((!index && start !== 0) || end <= start || end > frames || end - start > AUP3_MAX_BLOCK_SAMPLES
					|| blockId === 0 || (blockId < 0 && -blockId !== end - start)) throw new Error('Sequence positions cannot be reconstructed within the AUP3 block limits.');
				if (blockId < 0) continue;
				const existing = references.get(blockId);
				if (existing && existing.sampleFormat !== sampleFormat) throw new Error('Conflicting sample formats for one block.');
				const locations = existing?.locations ?? [];
				locations.push({ ...context, startFrame: start });
				references.set(blockId, { blockId, frames: Math.max(existing?.frames ?? 0, end - start), sampleFormat, locations });
			}
		}
		const ownedChildren = node.name === 'wavetrack' ? ['waveclip'] : ['sequence', 'waveclip'];
		if (node.name !== 'sequence') {
			for (const name of ownedChildren) for (const child of children(node, name)) visit(child, context);
		}
	}
	for (const track of children(root, 'wavetrack')) {
		visit(track, { trackName: '', clipName: '', clipOffsetSeconds: 0, sampleRate: Number(attribute(root, 'rate', 44100)) });
	}
	return references;
}

function rebuildBlock(reference: Reference, block: AudacityPageSamples | null) {
	const format = block?.sampleFormat ?? reference.sampleFormat;
	if (![0x00020001, 0x00040001, 0x0004000f].includes(format) || format !== reference.sampleFormat) throw new Error('Unsupported or inconsistent PCM sample format.');
	const width = format >>> 16;
	const frames = Math.max(reference.frames, Math.floor((block?.samples.byteLength ?? 0) / width));
	if (frames > AUP3_MAX_BLOCK_SAMPLES) throw new Error('AUP3 sample-block budget exceeded.');
	const bytes = new Uint8Array(frames * width);
	const preservedFrames = Math.min(frames, Math.floor((block?.readableBytes ?? 0) / width));
	if (block) bytes.set(block.samples.subarray(0, preservedFrames * width));
	let nonFiniteSamples = 0;
	if (format === 0x0004000f) {
		const data = new DataView(bytes.buffer);
		for (let frame = 0; frame < preservedFrames; frame++) {
			if (!Number.isFinite(data.getFloat32(frame * 4, true))) { data.setFloat32(frame * 4, 0, true); nonFiniteSamples++; }
		}
	}
	return { bytes, format, decoded: decodeAudacitySampleBlock(bytes, format, { maxSamples: AUP3_MAX_BLOCK_SAMPLES }),
		loss: { blockId: reference.blockId, preservedFrames: preservedFrames - nonFiniteSamples,
			silentFrames: frames - preservedFrames + nonFiniteSamples, nonFiniteSamples, locations: reference.locations } };
}

function sqliteFacade(database: DatabaseSync) {
	return { exec(input: string | { sql: string; bind?: readonly (number | string | Uint8Array | null)[] }) {
		if (typeof input === 'string') return database.exec(input);
		const statement = database.prepare(input.sql); statement.setReturnArrays(true);
		return statement.all(...(input.bind ?? []));
	} };
}
function integer(value: unknown, minimum: number): number {
	const result = Number(value);
	if (!Number.isSafeInteger(result) || result < minimum) throw new Error('Invalid Audacity sequence integer.');
	return result;
}
function assertNoJournal(source: string): void {
	for (const suffix of ['-wal', '-journal']) {
		if (existsSync(source + suffix) && statSync(source + suffix).size) throw new Error('Close Audacity and preserve its journal/WAL files. Repair needs a checkpointed, inactive AUP3 file.');
	}
}
function hashFile(fd: number, size: number): string {
	const hash = createHash('sha256'), buffer = new Uint8Array(1024 * 1024);
	for (let position = 0; position < size;) {
		const count = readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
		if (!count) throw new Error('The source changed during hashing.');
		hash.update(buffer.subarray(0, count)); position += count;
	}
	return hash.digest('hex');
}
