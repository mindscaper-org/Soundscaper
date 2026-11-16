/* SPDX-License-Identifier: AGPL-3.0-only */

import { decodeAudacityBinaryXml, audacityXmlAttribute, audacityXmlChildren } from './audacity-binary-xml.js';
import { createAup4DatabaseAdapter } from './aup4-database-sql.js';
import { validateAup4References } from './aup4-database-validation.js';
import { recoverAudacityProjectDatabase } from './audacity-project-recovery.ts';
import { inspectRecoverableAudacityBlock } from './audacity-project-recovery-audio.ts';
import { AUP4_HISTORY_DEPTH } from './aup4-profile-values.js';

export interface AudacityMissingRange {
	readonly blockId: number; readonly samples: number; readonly track: string; readonly clip: string;
	readonly startSeconds: number; readonly endSeconds: number;
	readonly valueOffset: number; readonly type: string;
}
export interface AudacityRecoveryInspection {
	readonly integrity: string; readonly integrityMessages: readonly string[];
	readonly activeDocument: string; readonly canRepair: boolean; readonly tracks: number; readonly clips: number;
	readonly blockRows: number; readonly orphanBlocks: number;
	readonly documents: readonly Readonly<{ source: string; readable: boolean; missingBlocks: number }>[];
	readonly missing: readonly AudacityMissingRange[];
}

interface Entry { kind: string; name?: string; type?: string; value?: unknown; valueOffset?: number; node?: Node }
interface Node { name: string; content: Entry[] }
const attr = audacityXmlAttribute as (node: Node, name: string, fallback?: unknown) => unknown;
const children = audacityXmlChildren as unknown as (node: Node, name: string) => Node[];

/** A read-only diagnostic; native repair is deliberately narrower than editing-copy salvage. */
export function inspectAudacityRecovery(database: unknown): AudacityRecoveryInspection {
	recoverAudacityProjectDatabase(database); // Reuse format, schema and future-version admission.
	const sql = createAup4DatabaseAdapter(database);
	const integrityMessages = sql.rows('PRAGMA integrity_check(100)').map((row: unknown[]) => String(row[0]));
	const integrity = integrityMessages.length === 1 && integrityMessages[0] === 'ok' ? 'ok' : 'failed';
	const ids = new Set<number>(sql.rows('SELECT blockid FROM sampleblocks').map((row: unknown[]) => Number(row[0])));
	const activeDocument = Number(sql.value('SELECT count(*) FROM autosave WHERE id=1')) ? 'autosave' : 'project';
	const referenced = new Set<number>(), missing: AudacityMissingRange[] = [], documents: Array<{ source: string; readable: boolean; missingBlocks: number }> = [];
	let canRepair = integrity === 'ok', tracks = 0, clips = 0;
	for (const table of ['project', 'autosave', 'project_history']) {
		let rows: unknown[][];
		try { rows = sql.rows(table === 'project_history' ? `SELECT generation, dict, doc FROM project_history ORDER BY generation DESC LIMIT ${String(AUP4_HISTORY_DEPTH)}` : `SELECT id, dict, doc FROM ${table} WHERE id=1`); }
		catch { if (table === activeDocument) canRepair = false; continue; }
		for (const [id, dictionary, document] of rows) {
			const summary = { source: table === 'project_history' ? `history ${String(id)}` : table, readable: false, missingBlocks: 0 };
			documents.push(summary);
			const active = table === activeDocument;
			try {
				const root = decodeAudacityBinaryXml(dictionary, document, { includeOffsets: true }).root as Node;
				if (root.name !== 'project') throw new Error('No project root.');
				summary.readable = true;
				if (active) tracks = children(root, 'wavetrack').length;
				const absent = new Set<number>();
				for (const track of children(root, 'wavetrack')) {
					const rate = Number(attr(track, 'rate', attr(root, 'rate', 0)));
					if (!(rate > 0) || !Number.isFinite(rate)) throw new Error('Invalid track rate.');
					for (const clip of children(track, 'waveclip')) {
						if (active) clips++;
						visit(clip, track, rate, 0, root);
					}
				}
				summary.missingBlocks = absent.size;
				if (active) validateAup4References(database, root, { includeNestedWaveClips: true, allowMissingSampleBlocks: false });

				function visit(clip: Node, track: Node, rate: number, parentOffset: number, root: Node): void {
					const offset = parentOffset + Number(attr(clip, 'offset', 0));
					let stretch = Number(attr(clip, 'clipStretchRatio', 1));
					const rawTempo = Number(attr(clip, 'rawAudioTempo', 0));
					const tempo = Number(attr(clip, 'clipTempo', attr(clip, 'clipStretchToMatchTempo', true) ? attr(root, 'time_signature_tempo', 120) : 0));
					if (rawTempo > 0 && tempo > 0) stretch *= rawTempo / tempo;
					if (!Number.isFinite(offset) || !Number.isFinite(stretch) || stretch <= 0) throw new Error('Invalid clip timing.');
					for (const sequence of children(clip, 'sequence')) {
						const length = Number(attr(sequence, 'numsamples', 0)), blocks = children(sequence, 'waveblock');
						if (!Number.isSafeInteger(length) || length < 0 || length > 0 && !blocks.length) throw new Error('Invalid sequence.');
						for (const [index, block] of blocks.entries()) {
							const start = Number(attr(block, 'start', 0)), end = index + 1 < blocks.length ? Number(attr(blocks[index + 1]!, 'start', 0)) : length;
							const blockId = Number(attr(block, 'blockid', 0)), samples = end - start;
							if (![start, end, blockId].every(Number.isSafeInteger) || index === 0 && start !== 0 || samples <= 0 || end > length || blockId === 0) throw new Error('Invalid block geometry.');
							if (blockId < 0) { if (-blockId !== samples) throw new Error('Invalid silent block.'); continue; }
							referenced.add(blockId);
							if (ids.has(blockId)) {
								if (active) {
									const audio = inspectRecoverableAudacityBlock(database, blockId);
									if (!audio || audio.usableFrames < samples || audio.nonFiniteSamples || audio.unreadableRanges.length) canRepair = false;
								}
								continue;
							}
							absent.add(blockId);
							if (!active) continue;
							const entry = block.content.filter(item => item.kind === 'attribute' && item.name === 'blockid').at(-1);
							if (!entry || !['int', 'long', 'long-long'].includes(entry.type ?? '') || entry.valueOffset == null || entry.type !== 'long-long' && samples > 0x7fffffff) canRepair = false;
							missing.push({ blockId, samples, track: String(attr(track, 'name', '')), clip: String(attr(clip, 'name', '')),
								startSeconds: offset + start * stretch / rate, endSeconds: offset + end * stretch / rate,
								valueOffset: entry?.valueOffset ?? -1, type: entry?.type ?? '' });
							if (entry) entry.value = -samples;
						}
					}
					for (const nested of children(clip, 'waveclip')) visit(nested, track, rate, offset, root);
				}
			} catch { summary.readable = false; if (active) canRepair = false; }
		}
	}
	return { integrity, integrityMessages, activeDocument, canRepair: canRepair && missing.length > 0, tracks, clips,
		blockRows: ids.size, orphanBlocks: [...ids].filter(id => !referenced.has(id)).length, documents, missing };
}
