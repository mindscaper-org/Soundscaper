/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';

import {
	framescaperDesktopProjectLibraryExactGenerationMetadataRevision as metadataRevision,
	setFramescaperDesktopProjectLibraryExactGenerationMetadataRevision as setMetadataRevision,
} from './project-library-exact-generation-database.ts';
import type { FramescaperDesktopProjectLibraryPaths } from './framescaper-project-library-contract.ts';
import type {
	FramescaperDesktopProjectLibraryExactGenerationLifecycle,
	FramescaperDesktopProjectLibraryExactPublicationBody,
	FramescaperDesktopProjectLibraryExactPublicationDeclaration,
} from './project-library-exact-generation-lifecycle.ts';
import type { ExactGenerationProject } from './project-library-exact-generation-body-configuration.ts';
import type { FramescaperDesktopProjectLibraryExactGenerationConfiguration } from './project-library-exact-generation-main.ts';
import { assertDesktopExpectedProjectDocument, DesktopProjectWriteFenceConflict } from './project-library-write-fence.ts';
import { withProjectLibraryImmediateTransaction } from './project-library-immediate-transaction.ts';
import {
	concatenateFramescaperDesktopProjectLibraryChunks as concatenate,
	framescaperDesktopProjectLibraryClosedRecord as closedRecord,
	framescaperDesktopProjectLibraryDenseArray as denseArray,
	framescaperDesktopProjectLibraryDigest as digest,
	framescaperDesktopProjectLibraryNonNegative as nonNegative,
	framescaperDesktopProjectLibraryPositive as positive,
	framescaperDesktopProjectLibrarySha256 as sha256,
	framescaperDesktopProjectLibraryText as text,
} from './framescaper-project-library-values.ts';
import { verifyProjectLibraryNativeBody } from './project-library-native-body-materialization.ts';

const EXPECTED_FIELDS = ['projectRevision', 'projectSha256'] as const;
const BODY_FIELDS = ['kind', 'encoding', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256'] as const;
const PROXY_BODY_FIELDS = ['kind', 'encoding', 'bindingId', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256'] as const;
const MAXIMUM_BODIES = 4_094;
const DELETED_FILE_BATCH = 64;

interface FramescaperDesktopExactProjectRow {
	readonly id: string;
	readonly projectId: string;
	readonly name: string;
	readonly metadataFile: string;
	readonly preferredProduct: 'framescaper';
	readonly updatedAtMs: number;
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: number;
	readonly projectRevision: number;
	readonly byteLength: number;
	readonly sha256: string;
}
export interface FramescaperDesktopExactBodyDescriptor {
	readonly kind:
		| 'video-original' | 'video-proxy' | 'video-timing'
		| 'framescaper-still' | 'framescaper-freeze-render'
		| 'framescaper-cube-lut' | 'framescaper-motion-analysis'
		| 'framescaper-image-asset'
		| 'image-sequence-inventory' | 'image-sequence-source-pack'
		| 'assistance-transcript' | 'assistance-tts-script';
	readonly encoding: string;
	readonly bindingId?: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperDesktopExactPublication {
	readonly publicationId: string;
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<{ projectRevision: number; projectSha256: string }> | null;
	readonly expectedDocument: unknown | null;
	readonly writeFence: string | null;
	readonly project: ExactGenerationProject;
	readonly document: string;
	readonly bodies: readonly Readonly<FramescaperDesktopExactBodyDescriptor>[];
	readonly chunks: Uint8Array[][];
	readonly offsets: number[];
}

export interface FramescaperDesktopExactStoredProjectRow {
	readonly entry_id: unknown;
	readonly project_id: unknown;
	readonly title: unknown;
	readonly updated_at_ms: unknown;
	readonly project_revision: unknown;
	readonly document_file: unknown;
	readonly byte_length: unknown;
	readonly sha256: unknown;
	readonly bodies_json: unknown;
}

export function readFramescaperDesktopExactProjectRow(database: DatabaseSync, projectId: string): FramescaperDesktopExactStoredProjectRow | null {
	return (database.prepare(`
		SELECT entry_id, project_id, title, updated_at_ms, project_revision,
			document_file, byte_length, sha256, bodies_json
		FROM projects WHERE project_id = ?
	`).get(text(projectId, 'project id')) as FramescaperDesktopExactStoredProjectRow | undefined) ?? null;
}

export async function readFramescaperDesktopExactProjectBundle(
	configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration,
	database: DatabaseSync,
	paths: Readonly<FramescaperDesktopProjectLibraryPaths>,
	row: FramescaperDesktopExactStoredProjectRow,
	configuredBodies: (configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration,
		project: unknown, projectSha256: string, value: unknown, stored: boolean) => readonly Readonly<FramescaperDesktopExactBodyDescriptor>[],
): Promise<unknown> {
	const project = framescaperDesktopExactProjectRow(row, configuration.schemaFamily ?? 'framescaper', configuration.schemaVersion);
	const document = await readFile(join(paths.projectsRoot, text(row.document_file, 'document file')), 'utf8');
	if (new TextEncoder().encode(document).byteLength !== project.byteLength || sha256(document) !== project.sha256) {
		throw new Error(`${configuration.label} project document failed integrity validation`);
	}
	const parsed = JSON.parse(document) as unknown;
	configuration.validateProject(parsed);
	return Object.freeze({
		metadataRevision: metadataRevision(database), project, document,
		bodies: configuredBodies(configuration, parsed, project.sha256, JSON.parse(text(row.bodies_json, 'body inventory')) as unknown, true),
	});
}

export function deleteFramescaperDesktopExactProject(
	configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration,
	database: DatabaseSync,
	paths: Readonly<FramescaperDesktopProjectLibraryPaths>,
	lifecycle: FramescaperDesktopProjectLibraryExactGenerationLifecycle | null,
	value: unknown,
) {
	const request = value as Record<string, unknown>;
	const projectId = text(request?.projectId, 'project id');
	const revision = nonNegative(request?.expectedMetadataRevision, 'metadata revision');
	const expected = framescaperDesktopExactStoredExpectedProject(request?.expectedProject, configuration.label);
	withProjectLibraryImmediateTransaction(database, () => {
		lifecycle?.assertLeaseInTransaction(database);
		if (revision !== metadataRevision(database)) throw new Error(`${configuration.label} metadata CAS failed`);
		const row = readFramescaperDesktopExactProjectRow(database, projectId);
		assertFramescaperDesktopExactExpectedProject(row, expected, configuration.label);
		if (row && lifecycle) {
			const docFile = `${sha256(projectId).slice(0, 48)}/${nonNegative(row.project_revision, 'project revision')}-${digest(row.sha256, 'document')}.json`;
			if (row.document_file !== docFile) throw new Error(`${configuration.label} deleted document path changed`);
			const insert = database.prepare('INSERT OR IGNORE INTO deleted_project_files (root, file) VALUES (?, ?)');
			insert.run('document', docFile);
			for (const file of storedBodyFiles(configuration, paths, row.bodies_json)) insert.run('body', file);
		}
		database.prepare('DELETE FROM projects WHERE project_id = ?').run(projectId);
		setMetadataRevision(database, revision + 1, configuration.label);
	}, { rollbackWhenInactive: true });
	return Object.freeze({ projectId, metadataRevision: revision + 1, deleted: true });
}

/** Retry exact committed deletions in short batches while the writer still owns the library. */
export async function reclaimDeletedFramescaperDesktopProjectFiles(
	configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration,
	database: DatabaseSync,
	paths: Readonly<FramescaperDesktopProjectLibraryPaths>,
	lifecycle: FramescaperDesktopProjectLibraryExactGenerationLifecycle | null,
): Promise<void> {
	if (!lifecycle) return;
	const upper = nonNegative(database.prepare('SELECT coalesce(max(id), 0) AS id FROM deleted_project_files').get()?.id, 'deleted file id');
	let cursor = 0;
	let referencedRevision = -1;
	let referenced: ReadonlySet<string> = new Set();
	while (cursor < upper) {
		withProjectLibraryImmediateTransaction(database, () => {
			lifecycle.assertLeaseInTransaction(database);
			if (database.prepare('SELECT 1 FROM publication_journal LIMIT 1').get()) { cursor = upper; return; }
			const batch = database.prepare('SELECT id, root, file FROM deleted_project_files WHERE id > ? AND id <= ? ORDER BY id LIMIT ?')
				.all(cursor, upper, DELETED_FILE_BATCH);
			if (batch.length === 0) { cursor = upper; return; }
			const revision = metadataRevision(database);
			if (revision !== referencedRevision) {
				referenced = referencedDeletionFiles(configuration, database, paths, cursor, upper);
				referencedRevision = revision;
			}
			const remove = database.prepare('DELETE FROM deleted_project_files WHERE id = ?');
			for (const row of batch) {
				cursor = nonNegative(row.id, 'deleted file id');
				const root = text(row.root, 'deleted file root');
				const file = text(row.file, 'deleted file name');
				if (referenced.has(`${root}:${file}`) || removeDeletedFile(paths, root, file)) remove.run(cursor);
			}
		}, { rollbackWhenInactive: true });
		if (cursor < upper) await setImmediate();
	}
}

function referencedDeletionFiles(
	configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration,
	database: DatabaseSync,
	paths: Readonly<FramescaperDesktopProjectLibraryPaths>,
	cursor: number,
	upper: number,
): Set<string> {
	const candidates = new Set<string>();
	let includeBodies = false;
	for (const row of database.prepare('SELECT root, file FROM deleted_project_files WHERE id > ? AND id <= ?').iterate(cursor, upper)) {
		const root = text(row.root, 'deleted file root');
		candidates.add(`${root}:${text(row.file, 'deleted file name')}`);
		includeBodies ||= root === 'body';
	}
	const referenced = new Set<string>();
	const fields = includeBodies ? 'document_file, bodies_json' : 'document_file';
	for (const row of database.prepare(`SELECT ${fields} FROM projects`).iterate()) {
		const document = `document:${text(row.document_file, 'document file')}`;
		if (candidates.has(document)) referenced.add(document);
		if (includeBodies) for (const file of storedBodyFiles(configuration, paths, row.bodies_json)) {
			const body = `body:${file}`;
			if (candidates.has(body)) referenced.add(body);
		}
	}
	return referenced;
}

function storedBodyFiles(configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration,
	paths: Readonly<FramescaperDesktopProjectLibraryPaths>, inventory: unknown): readonly string[] {
	return parseFramescaperDesktopExactBodies(inventory, configuration.label,
		configuration.validateBodyDescriptor ?? validateFramescaperDesktopExactBody, configuration.maximumBodies)
		.map(body => relative(paths.managedMediaRoot, framescaperDesktopExactMediaPath(paths, body)).split(sep).join('/'));
}

function removeDeletedFile(paths: Readonly<FramescaperDesktopProjectLibraryPaths>, root: string, file: string): boolean {
	const document = root === 'document';
	if (!document && root !== 'body') return false;
	const parts = file.split('/');
	const name = parts.pop();
	if (!name || parts.length !== (document ? 1 : 2) || [...parts, name].some(part => !/^[a-z0-9][a-z0-9.-]*$/u.test(part))) return false;
	let directory = document ? paths.projectsRoot : paths.managedMediaRoot;
	try {
		if (!lstatSync(directory).isDirectory()) return false;
		for (const part of parts) {
			directory = join(directory, part);
			if (!lstatSync(directory).isDirectory()) return false;
		}
		unlinkSync(join(directory, name));
		return true;
	} catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
}

export async function persistFramescaperDesktopExactPublication(
	configuration: FramescaperDesktopProjectLibraryExactGenerationConfiguration,
	database: DatabaseSync,
	paths: Readonly<FramescaperDesktopProjectLibraryPaths>,
	publication: FramescaperDesktopExactPublication,
	lifecycle: FramescaperDesktopProjectLibraryExactGenerationLifecycle | null = null,
	assertCurrent: () => void = () => undefined,
): Promise<unknown> {
	const bytes = new TextEncoder().encode(publication.document);
	const contentDigest = sha256(bytes);
	const entryId = sha256(String(publication.project.id)).slice(0, 48);
	const projectDirectory = join(paths.projectsRoot, entryId);
	await mkdir(projectDirectory, { recursive: true, mode: 0o700 });
	const documentFile = `${entryId}/${String(publication.project.revision)}-${contentDigest}.json`;
	const documentPath = join(paths.projectsRoot, documentFile);
	const declaration: Readonly<FramescaperDesktopProjectLibraryExactPublicationDeclaration> = Object.freeze({
		publicationId: publication.publicationId,
		projectId: String(publication.project.id),
		projectRevision: publication.project.revision,
		projectSha256: contentDigest,
		documentFile,
		expectedMetadataRevision: publication.expectedMetadataRevision,
	});
	const temporaryDocument = `${documentPath}.tmp-${randomBytes(8).toString('hex')}`;
	const temporaryBodies: Array<Readonly<{
		temporary: string;
		final: string;
		journal: Readonly<FramescaperDesktopProjectLibraryExactPublicationBody>;
	}>> = [];
	try {
		assertCurrent();
		await lifecycle?.preparePublication(declaration);
		await writeFile(temporaryDocument, bytes, { mode: 0o600, flag: 'wx' });
		for (const [index, body] of publication.bodies.entries()) {
			const final = framescaperDesktopExactMediaPath(paths, body);
			await mkdir(join(final, '..'), { recursive: true, mode: 0o700 });
			try {
				await verifyProjectLibraryNativeBody(final, body);
				continue;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				const bodyBytes = concatenate(publication.chunks[index]!, body.byteLength);
				if (sha256(bodyBytes) !== body.sha256) {
					throw new Error(`${configuration.label} publication body digest changed`);
				}
				const temporary = `${final}.tmp-${randomBytes(8).toString('hex')}`;
				await writeFile(temporary, bodyBytes, { mode: 0o600, flag: 'wx' });
				temporaryBodies.push({
					temporary, final,
					journal: Object.freeze({
						bodyFile: relative(paths.managedMediaRoot, final),
						kind: body.kind,
						storageKey: body.storageKey,
					}),
				});
			}
		}
		if (temporaryBodies.length > 0) await lifecycle?.preparePublicationBodies(
			declaration.publicationId, Object.freeze(temporaryBodies.map(({ journal }) => journal)),
		);
		for (const item of temporaryBodies) await rename(item.temporary, item.final);
		await rename(temporaryDocument, documentPath);
		assertCurrent();
		await lifecycle?.publicationMaterialized(declaration);
		const updatedAtMs = Date.parse(String(publication.project.updatedAt));
		if (!Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) {
			throw new TypeError(`${configuration.label} project timestamp is invalid`);
		}
		database.exec('BEGIN IMMEDIATE');
		try {
			assertCurrent();
			lifecycle?.assertCanCommit(database, declaration);
			if (publication.expectedDocument !== null) {
				const row = database.prepare(`SELECT project_revision, sha256, document_file FROM projects WHERE project_id = ?`)
					.get(String(publication.project.id)) as FramescaperDesktopExactStoredProjectRow | undefined;
				try { assertFramescaperDesktopExactExpectedProject(row ?? null, publication.expectedProject, configuration.label); }
				catch { throw new DesktopProjectWriteFenceConflict(); }
				assertFramescaperDesktopExactCurrentDocument(paths, row!, publication.expectedDocument);
			}
			if (metadataRevision(database) !== publication.expectedMetadataRevision) {
				throw new Error(`${configuration.label} metadata changed before publication`);
			}
			database.prepare(`
				INSERT INTO projects (
					entry_id, project_id, title, updated_at_ms, project_revision,
					document_file, byte_length, sha256, bodies_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(project_id) DO UPDATE SET
					title = excluded.title, updated_at_ms = excluded.updated_at_ms,
					project_revision = excluded.project_revision, document_file = excluded.document_file,
					byte_length = excluded.byte_length, sha256 = excluded.sha256,
					bodies_json = excluded.bodies_json
			`).run(
				entryId, String(publication.project.id), String(publication.project.title), updatedAtMs,
				publication.project.revision, documentFile, bytes.byteLength, contentDigest,
				JSON.stringify(publication.bodies),
			);
			setMetadataRevision(database, publication.expectedMetadataRevision + 1, configuration.label);
			database.exec('COMMIT');
		} catch (error) { database.exec('ROLLBACK'); throw error; }
		const result = Object.freeze({
			metadataRevision: publication.expectedMetadataRevision + 1,
			project: Object.freeze({
				id: entryId, projectId: String(publication.project.id), name: String(publication.project.title),
				metadataFile: documentFile, preferredProduct: 'framescaper', updatedAtMs,
				schemaFamily: configuration.schemaFamily ?? 'framescaper',
				schemaVersion: configuration.schemaVersion,
				projectRevision: publication.project.revision, byteLength: bytes.byteLength,
				sha256: contentDigest,
			}),
			document: publication.document,
			bodies: publication.bodies,
		});
		await lifecycle?.publicationCommitted(declaration, result);
		await lifecycle?.publicationComplete(declaration);
		await reclaimDeletedFramescaperDesktopProjectFiles(configuration, database, paths, lifecycle).catch(() => undefined);
		return result;
	} catch (error) {
		await rm(temporaryDocument, { force: true }).catch(() => undefined);
		await Promise.all(temporaryBodies.map(({ temporary }) => rm(temporary, { force: true })));
		throw error;
	}
}

export function framescaperDesktopExactProjectRow(
	row: FramescaperDesktopExactStoredProjectRow,
	schemaFamily: 'framescaper',
	schemaVersion: number,
): Readonly<FramescaperDesktopExactProjectRow> {
	return Object.freeze({
		id: text(row.entry_id, 'entry id'), projectId: text(row.project_id, 'project id'),
		name: text(row.title, 'title'), metadataFile: text(row.document_file, 'document file'),
		preferredProduct: 'framescaper', updatedAtMs: nonNegative(row.updated_at_ms, 'timestamp'),
		schemaFamily,
		schemaVersion, projectRevision: nonNegative(row.project_revision, 'project revision'),
		byteLength: positive(row.byte_length, 'document byte length'), sha256: digest(row.sha256, 'document'),
	});
}

export function parseFramescaperDesktopExactBodies(
	value: unknown,
	label: string,
	validate: (
		value: unknown,
		label: string,
	) => Readonly<FramescaperDesktopExactBodyDescriptor> = validateFramescaperDesktopExactBody,
	maximumBodies = MAXIMUM_BODIES,
): readonly Readonly<FramescaperDesktopExactBodyDescriptor>[] {
	if (typeof value !== 'string') throw new TypeError(`${label} body inventory is invalid`);
	return Object.freeze(denseArray(JSON.parse(value) as unknown, maximumBodies, `${label} bodies`)
		.map((body) => validate(body, label)));
}

export function validateFramescaperDesktopExactBody(
	value: unknown,
	label: string,
): Readonly<FramescaperDesktopExactBodyDescriptor> {
	const kind = (value as Record<string, unknown> | null)?.kind;
	const fields = kind === 'video-proxy' ? PROXY_BODY_FIELDS : BODY_FIELDS;
	const record = closedRecord(value, fields, `${label} body descriptor`);
	if (kind !== 'video-original' && kind !== 'video-proxy' && kind !== 'video-timing') {
		throw new TypeError(`${label} body kind is unsupported`);
	}
	const encoding = text(record.encoding, 'body encoding');
	if ((kind === 'video-original' && encoding !== 'framescaper-video-original-v1')
		|| (kind === 'video-proxy' && encoding !== 'video-proxy-v1')
		|| (kind === 'video-timing' && encoding !== 'soundscaper-video-timing-v1')) {
		throw new TypeError(`${label} body encoding is unsupported`);
	}
	const result: FramescaperDesktopExactBodyDescriptor = {
		kind, encoding,
		...(kind === 'video-proxy' ? { bindingId: text(record.bindingId, 'binding id') } : {}),
		sourceId: text(record.sourceId, 'source id'), storageKey: text(record.storageKey, 'storage key'),
		mimeType: text(record.mimeType, 'MIME type'), byteLength: positive(record.byteLength, 'body length'),
		sha256: digest(record.sha256, 'body'),
	};
	if (result.sourceId !== result.storageKey) throw new TypeError(`${label} body identity is inconsistent`);
	return Object.freeze(result);
}

export function framescaperDesktopExactMediaPath(
	paths: Readonly<FramescaperDesktopProjectLibraryPaths>,
	body: FramescaperDesktopExactBodyDescriptor,
): string {
	const extension = body.kind === 'video-original' ? '.media'
		: body.kind === 'video-proxy' ? '.proxy'
			: body.kind === 'video-timing' ? '.scti'
				: body.kind === 'assistance-transcript' ? '.transcript.json'
					: body.kind === 'assistance-tts-script' ? '.tts-script.json'
				: body.kind === 'framescaper-cube-lut' ? '.cube'
					: body.kind === 'framescaper-motion-analysis' ? '.json'
						: body.kind === 'image-sequence-inventory' ? '.inventory.json'
							: body.kind === 'image-sequence-source-pack' ? '.sequence-pack'
								: body.kind === 'framescaper-image-asset' ? '.frame-pack' : '.image';
	// Timeline-image keys identify distinct sources even when their frame packs match.
	const stem = body.kind === 'framescaper-image-asset' ? `${sha256(body.storageKey)}-${body.sha256}` : body.sha256;
	return join(paths.managedMediaRoot, body.kind, body.sha256.slice(0, 2), `${stem}${extension}`);
}

export function assertFramescaperDesktopExactExpectedProject(
	row: FramescaperDesktopExactStoredProjectRow | null,
	expected: Readonly<{ projectRevision: number; projectSha256: string }> | null,
	label: string,
): void {
	if (expected === null) {
		if (row) throw new Error(`${label} expected an absent project`);
		return;
	}
	if (!row || row.project_revision !== expected.projectRevision || row.sha256 !== expected.projectSha256) {
		throw new Error(`${label} expected project failed compare-and-swap`);
	}
}

export function assertFramescaperDesktopExactCurrentDocument(
	paths: Readonly<FramescaperDesktopProjectLibraryPaths>,
	row: FramescaperDesktopExactStoredProjectRow | null,
	expected: unknown,
): void {
	if (!row) throw new DesktopProjectWriteFenceConflict();
	const document = readFileSync(join(paths.projectsRoot, text(row.document_file, 'document file')), 'utf8');
	assertDesktopExpectedProjectDocument(expected, document);
}

export function checkFramescaperDesktopExactCurrentWriteFence(
	database: DatabaseSync,
	paths: Readonly<FramescaperDesktopProjectLibraryPaths>,
	projectId: string,
	expected: unknown,
	assertFence: () => void,
): boolean {
	database.exec('BEGIN IMMEDIATE');
	try {
		assertFence();
		assertFramescaperDesktopExactCurrentDocument(paths,
			readFramescaperDesktopExactProjectRow(database, projectId), expected);
		database.exec('COMMIT');
		return true;
	} catch (error) {
		database.exec('ROLLBACK');
		if (error instanceof DesktopProjectWriteFenceConflict) return false;
		throw error;
	}
}

export function framescaperDesktopExactGenerationProject(value: unknown, label: string): ExactGenerationProject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} project must be a record`);
	const project = value as Record<string, unknown>;
	text(project.id, 'project id');
	text(project.title, 'project title');
	nonNegative(project.revision, 'project revision');
	framescaperDesktopExactProjectTimestamp(project.updatedAt, 'updatedAt', label);
	return project as ExactGenerationProject;
}

export function framescaperDesktopExactStoredExpectedProject(
	value: unknown,
	label: string,
): Readonly<{ projectRevision: number; projectSha256: string }> | null {
	if (value === null) return null;
	const record = closedRecord(value, EXPECTED_FIELDS, `${label} expected project`);
	return Object.freeze({
		projectRevision: nonNegative(record.projectRevision, 'project revision'),
		projectSha256: digest(record.projectSha256, 'project'),
	});
}

export function framescaperDesktopExactProjectTimestamp(
	value: unknown,
	field: string,
	label: string,
): string {
	const result = text(value, field);
	if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
		throw new TypeError(`${label} ${field} is invalid`);
	}
	return result;
}
