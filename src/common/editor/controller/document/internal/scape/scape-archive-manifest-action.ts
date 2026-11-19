/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The checksum manifest of the last Scape archive written for an open project.
 *
 * It is built by reading the written archive back and digesting what is in it,
 * never by copying the digests the writer computed on the way out. A manifest
 * that repeats the writer's own numbers agrees with the writer by construction
 * and would certify an archive the writer got wrong.
 *
 * That is also why a streamed save produces no manifest. When the archive goes
 * straight to its destination there are no bytes left to read back, and the
 * honest answer is to say the archive was never held rather than to publish a
 * manifest of something else — the same distinction the delivery conformance
 * path already draws between "we did not check" and "we checked and it passed".
 */

import {
	saveArchiveManifest,
	type ArchiveManifest,
} from '../../../../archive-manifest.ts';
import type { LocalizedPresentationMessage } from '../../../../../i18n/presentation-message.ts';
import { PROJECT_MEDIA_COPY_BY_LOCALE } from '../../../../../i18n/editor-project-media-copy.ts';

export interface ScapeArchiveManifestRuntime {
	/** Session state; the manifest is recorded on it like the delivery report. */
	readonly state: object;
	readonly fileService?: { saveFile?: (request: never) => unknown } | null;
	readonly publishDocumentSnapshot?: () => void;
}

export interface ArchiveManifestSessionRecord {
	readonly manifest: ArchiveManifest | null;
	/** Why no manifest exists, when none does. */
	readonly unavailable: string | null;
	readonly unavailableLocalization?: LocalizedPresentationMessage;
	readonly fileName: string;
}

interface ProjectArchiveReadback {
	record: ArchiveManifestSessionRecord | null;
}

const readbacks = new WeakMap<object, Map<string, ProjectArchiveReadback>>();

export function currentScapeArchiveManifest(state: object, projectId: unknown): ArchiveManifestSessionRecord | null {
	return typeof projectId === 'string' ? readbacks.get(state)?.get(projectId)?.record ?? null : null;
}

export function retireScapeArchiveManifests(state: object, retainProject: (id: string) => boolean): void {
	const projects = readbacks.get(state);
	if (!projects) return;
	for (const id of projects.keys()) if (!retainProject(id)) projects.delete(id);
}

/** Record the manifest of a saved archive, or why one could not be made. */
export async function recordScapeArchiveManifest(
	runtime: ScapeArchiveManifestRuntime,
	request: Readonly<{
		projectId: string;
		archive: Blob | null | undefined;
		fileName: string;
		projectTitle?: string | null;
		signal: AbortSignal;
	}>,
): Promise<ArchiveManifestSessionRecord> {
	let projects = readbacks.get(runtime.state);
	if (!projects) readbacks.set(runtime.state, projects = new Map());
	const { projectId } = request;
	const pending = { record: projects.get(projectId)?.record ?? null };
	projects.set(projectId, pending);
	const record = await manifestRecord(request);
	if (projects.get(projectId) === pending) {
		pending.record = record;
		runtime.publishDocumentSnapshot?.();
	}
	return record;
}

async function manifestRecord(
	request: Readonly<{
		archive: Blob | null | undefined;
		fileName: string;
		projectTitle?: string | null;
		signal: AbortSignal;
	}>,
): Promise<ArchiveManifestSessionRecord> {
	if (!(request.archive instanceof Blob)) {
		return Object.freeze({
			manifest: null,
			unavailable: PROJECT_MEDIA_COPY_BY_LOCALE.en.archiveStreamed,
			unavailableLocalization: { key: 'ui.projectMedia.archiveStreamed', fallback: PROJECT_MEDIA_COPY_BY_LOCALE.en.archiveStreamed },
			fileName: request.fileName,
		});
	}
	try {
		const { createScapeArchiveManifest } = await import('../../../../scape-archive-manifest.ts');
		return Object.freeze({
			manifest: await createScapeArchiveManifest(request.archive, {
				...(request.projectTitle ? { projectTitle: request.projectTitle } : {}),
				signal: request.signal,
			}),
			unavailable: null,
			fileName: request.fileName,
		});
	} catch (error) {
		// The archive is written and saved by the time this runs. Evidence about
		// it that could not be gathered is a missing manifest with its reason
		// recorded, never a failed save of a file that is already on disk.
		return Object.freeze({
			manifest: null,
			unavailable: `The written archive could not be read back: ${errorText(error)}`,
			unavailableLocalization: { key: 'ui.projectMedia.archiveUnreadable', parameters: { message: errorText(error) },
				fallback: PROJECT_MEDIA_COPY_BY_LOCALE.en.archiveUnreadable },
			fileName: request.fileName,
		});
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Save the recorded manifest as a report document. */
export async function saveCurrentScapeArchiveManifest(
	runtime: ScapeArchiveManifestRuntime,
	projectId: unknown,
): Promise<Readonly<{ saved: boolean; reason: string | null; localization?: LocalizedPresentationMessage }>> {
	const record = currentScapeArchiveManifest(runtime.state, projectId);
	if (!record?.manifest) {
		return Object.freeze({ saved: false, reason: record?.unavailable ?? PROJECT_MEDIA_COPY_BY_LOCALE.en.noArchive,
			localization: record?.unavailable ? record.unavailableLocalization : {
				key: 'ui.projectMedia.noArchive', fallback: PROJECT_MEDIA_COPY_BY_LOCALE.en.noArchive,
			} });
	}
	const saved = await saveArchiveManifest(
		record.manifest,
		runtime.fileService as Parameters<typeof saveArchiveManifest>[1],
	);
	if (saved.cancelled) return Object.freeze({ saved: false, reason: null });
	return Object.freeze({ saved: true, reason: null });
}
