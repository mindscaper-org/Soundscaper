/* SPDX-License-Identifier: AGPL-3.0-only */

import { audacityXmlAttribute, audacityXmlChildren, decodeAudacityBinaryXml } from './audacity-binary-xml.js';
import { createAup4DatabaseAdapter, toBytes } from './aup4-database-sql.js';
import { readSchemaObjects, validateAup4References, validatePinnedColumns, validatePinnedTableDefinitions } from './aup4-database-validation.js';
import { AUP4_HISTORY_DEPTH, Aup4Error, addAup4CompatibilityItem, createAup4CompatibilityReport, inspectAup4Header, readAup4ProjectSummary, validateAup4SchemaObjects } from './aup4-profile.js';
import { sanitizeAup4Document } from './aup4-sanitization.js';
import { inspectRecoverableAudacityBlock, type RecoveredAudacityBlock } from './audacity-project-recovery-audio.ts';

interface XmlEntry { kind: string; name?: string; type?: string; value?: unknown; node?: XmlNode }
interface XmlNode { name: string; content: XmlEntry[] }
interface Adapter {
	exec(sql: string): unknown;
	rows(sql: string): unknown[][];
	value(sql: string): unknown;
}
interface Candidate { source: 'autosave' | 'project' | 'history'; generation: number | null; dictionary: Uint8Array; document: Uint8Array }
interface Failure { source: string; generation: number | null; code: string; message: string }
interface RecoveryItem {
	code: string; severity: 'warning'; disposition: 'converted' | 'omitted';
	scope: Record<string, unknown>; data: Record<string, unknown>; message: string;
}
const children = audacityXmlChildren as unknown as (node: XmlNode, name: string) => XmlNode[];
const attribute = audacityXmlAttribute as (node: XmlNode, name: string, fallback?: unknown) => unknown;

/** Salvage only a private import copy. This never edits the source database. */
export function recoverAudacityProjectDatabase(database: unknown) {
	try { return inspectRecoveryDatabase(database); }
	catch (error: unknown) {
		if (error instanceof Aup4Error) throw error;
		throw unrecoverable(error);
	}
}

function inspectRecoveryDatabase(database: unknown) {
	const adapter = createAup4DatabaseAdapter(database) as Adapter;
	adapter.exec('PRAGMA trusted_schema = OFF');
	const applicationId = Number(adapter.value('PRAGMA application_id'));
	const userVersion = Number(adapter.value('PRAGMA user_version'));
	// Legacy AUP3 snapshots use user_version zero; the normal import migrates them.
	const header = inspectAup4Header({ applicationId, userVersion: Math.max(1, userVersion), xmlVersion: null });
	if (!header.compatible) throw new Aup4Error(header.issues[0]?.message, header.issues[0]?.code);
	let schemaObjects: ReturnType<typeof readSchemaObjects>;
	try { schemaObjects = readSchemaObjects(adapter); }
	catch (error: unknown) { throw unrecoverable(error); }
	validateAup4SchemaObjects(schemaObjects);
	const allowMissing = new Set(['project_history']);
	validatePinnedTableDefinitions(schemaObjects, { allowMissing });
	validatePinnedColumns(adapter, { allowMissing });
	const tables = new Set<string>(schemaObjects.filter((entry: { type: string }) => entry.type === 'table').map((entry: { name: string }) => entry.name));
	const failures: Failure[] = [];
	const candidates = readCandidates(adapter, tables, failures);
	let sqliteIssue = '';
	try {
		const check = String(adapter.value('PRAGMA quick_check(1)') ?? '');
		if (check.toLowerCase() !== 'ok') sqliteIssue = check || 'SQLite integrity check could not certify the source.';
	} catch (error: unknown) { sqliteIssue = errorMessage(error); }
	const readable: Array<{ candidate: Candidate; document: ReturnType<typeof decodeAudacityBinaryXml> }> = [];
	for (const candidate of candidates) {
		try {
			const document = decodeAudacityBinaryXml(candidate.dictionary, candidate.document);
			const summary = readAup4ProjectSummary(document.root);
			const profile = inspectAup4Header({ applicationId, userVersion: Math.max(1, userVersion), xmlVersion: summary.xmlVersion });
			if (!profile.compatible) throw new Aup4Error(profile.issues[0]?.message, profile.issues[0]?.code);
			readable.push({ candidate, document });
			try {
				validateAup4References(database, document.root, { includeNestedWaveClips: true, allowMissingSampleBlocks: false });
				return recoverDocument(database, { candidate, document }, { applicationId, userVersion, schemaObjects, failures, sqliteIssue });
			} catch (error: unknown) { failures.push(failure(candidate, error)); }
		} catch (error: unknown) {
			if (error instanceof Aup4Error && ['NEWER_XML', 'NEWER_DATABASE'].includes(error.code)) throw error;
			failures.push(failure(candidate, error));
		}
	}
	const salvage = readable[0];
	if (!salvage) throw unrecoverable(failures[0]?.message);
	return recoverDocument(database, salvage, { applicationId, userVersion, schemaObjects, failures, sqliteIssue });
}

function readCandidates(adapter: Adapter, tables: ReadonlySet<string>, failures: Failure[]): Candidate[] {
	const output: Candidate[] = [];
	for (const source of ['autosave', 'project', 'history'] as const) {
		if (!tables.has(source === 'history' ? 'project_history' : source)) continue;
		try {
			const rows = source === 'history' ? adapter.rows(`SELECT generation, dict, doc FROM project_history ORDER BY generation DESC LIMIT ${String(AUP4_HISTORY_DEPTH)}`)
				: adapter.rows(`SELECT id, dict, doc FROM ${source} WHERE id = 1 LIMIT 1`);
			for (const [generation, dict, doc] of rows) {
				if (!(dict instanceof Uint8Array) || !(doc instanceof Uint8Array) || !dict.byteLength || !doc.byteLength) {
					failures.push({ source, generation: source === 'history' ? Number(generation) : null, code: 'EMPTY_PROJECT', message: 'The document is incomplete.' });
					continue;
				}
				output.push({ source, generation: source === 'history' ? Number(generation) : null,
					dictionary: toBytes(dict).slice(), document: toBytes(doc).slice() });
			}
		} catch (error: unknown) { failures.push({ source, generation: null, code: 'CORRUPT_DATABASE', message: errorMessage(error) }); }
	}
	return output;
}

function recoverDocument(database: unknown,
	selected: { candidate: Candidate; document: ReturnType<typeof decodeAudacityBinaryXml> },
	context: { applicationId: number; userVersion: number; schemaObjects: ReturnType<typeof readSchemaObjects>; failures: Failure[]; sqliteIssue: string },
) {
	const sanitized = sanitizeAup4Document(selected.document);
	const document = sanitized.document;
	const root = document.root as XmlNode;
	const audio = new Map<number, RecoveredAudacityBlock>();
	const report = createAup4CompatibilityReport('open', { discardedCloudMetadata: sanitized.report }) as {
		items: RecoveryItem[]; [key: string]: unknown;
	};
	const add = (item: RecoveryItem): void => { addAup4CompatibilityItem(report, item); };
	add({ code: 'AUDACITY_RECOVERY_COPY', severity: 'warning', disposition: 'converted', scope: { kind: 'project' },
		data: { originalFilePreserved: true }, message: 'A recovered editing copy was created. The original Audacity file is unchanged; review the losses before exporting a new project file.' });
	if (context.failures.length || selected.candidate.source === 'history') add({
		code: 'RECOVERED_DOCUMENT', severity: 'warning', disposition: 'converted', scope: { kind: 'project' },
		data: { source: selected.candidate.source, generation: selected.candidate.generation, failures: context.failures },
		message: `Used ${selected.candidate.source === 'history' ? `saved history generation ${String(selected.candidate.generation)}` : `the ${selected.candidate.source} document`}. Unreadable project documents and edits available only in them were not recovered.`,
	});
	if (context.sqliteIssue) add({ code: 'SQLITE_PARTIAL_RECOVERY', severity: 'warning', disposition: 'converted', scope: { kind: 'project' },
		data: { diagnostic: context.sqliteIssue }, message: 'SQLite reported structural damage. Only readable project and audio rows were imported; inspect and back up this recovered copy.' });
	if (sanitized.report.discardedEntries) add({ code: 'EXCLUDED_CLOUD_METADATA', severity: 'warning', disposition: 'omitted', scope: { kind: 'project' },
		data: { discardedEntries: sanitized.report.discardedEntries }, message: 'Cloud and account metadata was excluded from the recovered editing copy.' });
	let references = 0;
	for (const [trackIndex, track] of children(root, 'wavetrack').entries()) {
		for (const [clipIndex, clip] of children(track, 'waveclip').entries()) {
			try {
				recoverClip(clip, (sequence) => {
					const frames = integer(attribute(sequence, 'numsamples', 0), 0);
					const blocks = children(sequence, 'waveblock');
					if (frames > 0 && !blocks.length) throw new Error('Sequence has no sample-block references.');
					for (const [index, block] of blocks.entries()) {
						if (++references > 1_000_000) throw new Aup4Error('Too many Audacity recovery block references.', 'REFERENCE_LIMIT');
						const start = integer(attribute(block, 'start', 0), 0);
						const end = index + 1 < blocks.length ? integer(attribute(blocks[index + 1]!, 'start', 0), 0) : frames;
						if (index === 0 && start !== 0 || end <= start || end > frames) throw new Error('Block positions cannot reconstruct the original clip duration.');
						const count = end - start, blockId = integer(attribute(block, 'blockid', 0), Number.MIN_SAFE_INTEGER);
						if (blockId === 0 || blockId < 0 && -blockId !== count) throw new Error('Invalid silent block identity.');
						setAttribute(block, 'length', count);
						if (blockId < 0) continue;
						let recovered = audio.get(blockId);
						if (!recovered) recovered = inspectRecoverableAudacityBlock(database, blockId) ?? undefined;
						if (recovered) audio.set(blockId, recovered);
						const missingFrames = recovered ? Math.max(0, count - recovered.usableFrames)
							+ recovered.unreadableRanges.reduce((sum, range) => sum + Math.max(0, Math.min(count, range.end) - range.start), 0)
							+ recovered.nonFiniteSamples : count;
						if (!recovered || recovered.usableFrames === 0) setAttribute(block, 'blockid', -count);
						if (missingFrames) add({ code: 'RECOVERED_AUDIO_SILENCE', severity: 'warning', disposition: 'converted',
							scope: { kind: 'clip', trackIndex, clipIndex, name: String(attribute(track, 'name', 'Audio')) },
							data: { blockId, startFrame: start, originalFrames: count, silentFrames: Math.min(count, missingFrames), sampleRate: Number(attribute(track, 'rate', 0)) },
							message: `Audio block ${String(blockId)}: ${String(Math.min(count, missingFrames))} of ${String(count)} samples were replaced with silence. Clip placement and duration were preserved.` });
					}
				});
			} catch (error: unknown) {
				if (error instanceof Aup4Error && error.code === 'REFERENCE_LIMIT') throw error;
				track.content = track.content.filter((entry) => entry.node !== clip);
				add({ code: 'RECOVERY_CLIP_OMITTED', severity: 'warning', disposition: 'omitted',
					scope: { kind: 'clip', trackIndex, clipIndex, name: String(attribute(track, 'name', 'Audio')) },
					data: { offsetSeconds: attribute(clip, 'offset', 0), reason: errorMessage(error) },
					message: `Clip ${String(clipIndex + 1)} in track ${String(trackIndex + 1)} could not be reconstructed and was omitted. Other clips retain their original positions. ${errorMessage(error)}` });
			}
		}
	}
	const summary = readAup4ProjectSummary(root);
	return { compatible: true, readOnly: false, applicationId: context.applicationId, userVersion: context.userVersion,
		xmlVersion: summary.xmlVersion, source: selected.candidate.source, generation: selected.candidate.generation,
		document, summary, schemaObjects: context.schemaObjects, references: null, audio,
		compatibilityReport: report, recovery: { failures: context.failures, source: selected.candidate.source, generation: selected.candidate.generation },
		issues: report.items.map((item) => ({ code: item.code, level: 'warning', message: item.message })) };
}

function recoverClip(clip: XmlNode, recover: (sequence: XmlNode) => void): void {
	for (const sequence of children(clip, 'sequence')) recover(sequence);
	for (const nested of children(clip, 'waveclip')) recoverClip(nested, recover);
}
function setAttribute(node: XmlNode, name: string, value: number): void {
	const entry = node.content.find((item) => item.kind === 'attribute' && item.name === name);
	if (entry) { entry.value = value; entry.type = 'long-long'; }
	else node.content.unshift({ kind: 'attribute', name, type: 'long-long', value });
}
function integer(value: unknown, minimum: number): number {
	const result = Number(value);
	if (!Number.isSafeInteger(result) || result < minimum) throw new Error('Invalid Audacity sequence length or block position.');
	return result;
}
function failure(candidate: Candidate, error: unknown): Failure {
	return { source: candidate.source, generation: candidate.generation,
		code: error instanceof Error && 'code' in error ? String(error.code) : 'INVALID_PROJECT_XML', message: errorMessage(error) };
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error ?? 'Unreadable project data.'); }
function unrecoverable(error: unknown): Aup4Error {
	return new Aup4Error(`No readable Audacity project document could be recovered. Keep the original file and any -wal/-shm files. For SQLite page recovery, try Audacity Project Tools on a copy. ${errorMessage(error)}`, 'AUDACITY_RECOVERY_FAILED');
}
