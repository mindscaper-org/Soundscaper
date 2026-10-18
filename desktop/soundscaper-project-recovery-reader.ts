/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { parseScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import type { ProjectRecoveryCandidate, ProjectRecoverySummary } from '../src/common/editor/storage/project-recovery-repository.ts';
import { validateSoundscaperDesktopProjectLibraryProjectId } from './soundscaper-project-library-transfer-contract.ts';

const MAXIMUM_DOCUMENT_BYTES = 256 * 1024 * 1024;
const MAXIMUM_RECOVERY_REVISIONS = 32;

/** Recover from the independent SQLite document snapshot when ordinary file/bundle verification fails. */
export function readSoundscaperDesktopProjectRecoveryCandidates(
	database: DatabaseSync, projectIdValue: string, currentRevision: number | null = null,
): readonly ProjectRecoveryCandidate[] {
	const projectId = validateSoundscaperDesktopProjectLibraryProjectId(projectIdValue);
	const rows = database.prepare(`SELECT project_revision, document_json, project_sha256
		FROM project_revisions WHERE project_id = ? ORDER BY project_revision DESC LIMIT ?`)
		.all(projectId, MAXIMUM_RECOVERY_REVISIONS);
	return rows.map((row) => {
		const revision = Number(row.project_revision);
		const key = `desktop:${projectId}:${String(revision)}`;
		const kind = revision === currentRevision ? 'current' as const : 'revision' as const;
		try {
			if (typeof row.document_json !== 'string' || Buffer.byteLength(row.document_json, 'utf8') > MAXIMUM_DOCUMENT_BYTES) {
				throw new Error('The desktop recovery document exceeds its supported size.');
			}
			const project = parseScapeProjectDocument(row.document_json, { currentProjectSchemaFamily: 'soundscaper' });
			const digest = createHash('sha256').update(row.document_json, 'utf8').digest('hex');
			return { key, kind, revision, project,
				...(digest === row.project_sha256 ? {} : { diagnostic: 'The stored document checksum changed; review the repaired copy.' }) };
		} catch (error) {
			return { key, kind, revision, project: null,
				diagnostic: error instanceof Error ? error.message : String(error) };
		}
	});
}

export function listSoundscaperDesktopProjectRecoverySummaries(database: DatabaseSync): readonly ProjectRecoverySummary[] {
	const rows = database.prepare(`SELECT project_id, MAX(project_revision) AS revision
		FROM project_revisions GROUP BY project_id LIMIT 4096`).all();
	return rows.map((row) => {
		const id = String(row.project_id);
		const latest = readSoundscaperDesktopProjectRecoveryCandidates(database, id)[0];
		const project = latest?.project as Record<string, unknown> | null;
		return { id, title: typeof project?.title === 'string' && project.title.trim() ? project.title : 'Damaged project',
			revision: Number(row.revision) };
	});
}
