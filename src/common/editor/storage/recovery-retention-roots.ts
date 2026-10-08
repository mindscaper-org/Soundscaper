/* SPDX-License-Identifier: AGPL-3.0-only */
import { collectProjectStorageKeys, compactProjectSourceMetadata } from '../retention.js';
import { RECORDING_RECOVERY_KEY_PREFIX } from './recording-recovery-journal-repository.ts';
import { request } from './indexeddb-backend.ts';

/** Malformed snapshots remain byte-for-byte candidates and retain every identifiable source. */
export function collectRecoverableProjectStorageKeys(project: unknown, target: Set<string>, validate?: (project: unknown) => boolean): void {
	try { collectProjectStorageKeys(project, target); } catch { /* Preserve the safely identifiable inventory below. */ }
	if (!damagedShape(project, validate)) return;
	collectRawStorageReferences(project, target);
}
export function compactRecoverableProjectMetadata(project: unknown, validate?: (project: unknown) => boolean): unknown {
	if (damagedShape(project, validate)) return project;
	try { return compactProjectSourceMetadata(project); } catch { return project; }
}
export function collectRecordingRecoveryRoots(rows: Iterable<unknown>, target: Set<string>): void {
	for (const value of rows) {
		const row = record(value);
		if (typeof row?.key !== 'string' || !row.key.startsWith(RECORDING_RECOVERY_KEY_PREFIX)) continue;
		const journal = record(row.value);
		if (!journal || journal.decision === 'discard') continue;
		// Read conservatively instead of rejecting a damaged journal and releasing its audio.
		collectRawStorageReferences(journal, target);
	}
}
export function assertSourceNotRecoveryRetained(sourceId: string, rows: Iterable<unknown>): void {
	const retained = new Set<string>(); collectRecordingRecoveryRoots(rows, retained);
	if (retained.has(sourceId)) throw new Error(`Source ${sourceId} is retained by recording recovery.`);
}
export async function assertStoredSourceNotRecoveryRetained(sourceId: string, analysis: IDBObjectStore): Promise<void> {
	assertSourceNotRecoveryRetained(sourceId, await request(analysis.getAll()));
}
function damagedShape(value: unknown, validate?: (project: unknown) => boolean): boolean {
	const project = record(value);
	if (!project) return false;
	if (validate) { try { if (!validate(value)) return true; } catch { return true; } }
	for (const field of ['sources', 'clips', 'tracks', 'sequences', 'takeGroups']) {
		if (project[field] !== undefined && (!Array.isArray(project[field])
			|| (project[field] as unknown[]).some((entry) => record(entry) === null))) return true;
	}
	return project.revision !== undefined && (!Number.isSafeInteger(project.revision) || Number(project.revision) < 0);
}
function collectRawStorageReferences(value: unknown, target: Set<string>): void {
	const pending: unknown[] = [value]; const seen = new Set<object>();
	let inspected = 0;
	while (pending.length && inspected < 262_144) {
		const next = pending.pop(); inspected += 1;
		if (!next || typeof next !== 'object' || seen.has(next)) continue;
		seen.add(next);
		if (Array.isArray(next)) {
			if (next.length > 65_536) throw new Error('Recovery source inventory exceeds its safe array limit.');
			pending.push(...next); continue;
		}
		const row = record(next)!;
		for (const field of ['sourceId', 'storageKey', 'baseSourceId', 'derivedSourceId']) {
			if (typeof row[field] === 'string' && row[field]) target.add(row[field]);
		}
		if (Array.isArray(row.sources)) for (const source of row.sources as unknown[]) {
			const item = record(source); if (typeof item?.id === 'string' && item.id) target.add(item.id);
		}
		pending.push(...Object.values(row));
	}
	if (pending.length) throw new Error('Recovery source inventory exceeds its safe traversal limit.');
}
function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}
