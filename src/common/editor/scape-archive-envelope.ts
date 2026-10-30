/* SPDX-License-Identifier: AGPL-3.0-only */

import { annotateFormatFileFailure, withFormatFileParserFailureAsync } from './format-file-parser-failure.ts';
import { readProjectSchemaIdentity, type ProjectSchemaFamily } from './project-schema-identity.ts';
import { parseOpaqueScapeProjectDocument } from './scape-project-document.ts';
import { confirmFileSizeWarning, type FileSizeWarningOptions } from './controller/shared/file-size-warning.ts';
import {
	readScapeArchiveEnvelope as readContainerEnvelope,
	ScapeArchiveReimportRequiredError,
	type ScapeArchiveEntry,
	type ScapeArchiveEnvelope as ContainerEnvelope,
	type ScapeManifest as ContainerManifest,
	type ScapeProjectDescriptor as ContainerProjectDescriptor,
} from '../scape/archive-envelope.ts';
import type { ScapeArchiveLimits } from '../scape/archive-limits.ts';

export type ScapeArchiveEnvelope = ContainerEnvelope<ProjectSchemaFamily>;
export type ScapeManifest = ContainerManifest<ProjectSchemaFamily>;
export type ScapeProjectDescriptor = ContainerProjectDescriptor<ProjectSchemaFamily>;

/** Timeline family codecs and presentation stay outside the container machinery. */
export function readScapeArchiveEnvelope(
	entries: readonly ScapeArchiveEntry[],
	limitOverrides: Partial<ScapeArchiveLimits> = {},
	signal?: AbortSignal,
	additionalAssetKinds: readonly string[] = [],
	desktopImport = false,
	warningOptions: FileSizeWarningOptions = {},
): Promise<ScapeArchiveEnvelope> {
	return withFormatFileParserFailureAsync('scape', 'ARCHIVE_ENVELOPE', async () => {
		try {
			return await readContainerEnvelope(entries, {
				assetKinds: ['audio', 'video', 'video-timing'],
				readIdentity: readProjectSchemaIdentity,
				parseProjectDocument: parseOpaqueScapeProjectDocument,
			}, limitOverrides, signal, additionalAssetKinds, desktopImport, warningOptions.confirmFileSizeWarning ? {
				admitSize: (byteLength, thresholdBytes, label, currentSignal) => confirmFileSizeWarning(
					byteLength, thresholdBytes, label, { ...warningOptions, signal: currentSignal },
				),
			} : undefined);
		} catch (error) {
			if (error instanceof ScapeArchiveReimportRequiredError) annotateFormatFileFailure(error, 'scape', 'REIMPORT_REQUIRED');
			throw error;
		}
	});
}
