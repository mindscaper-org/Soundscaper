/* SPDX-License-Identifier: AGPL-3.0-only */

import { annotateFormatFileFailure, withFormatFileParserFailureAsync } from './format-file-parser-failure.ts';
import { readProjectSchemaIdentity, type ProjectSchemaFamily } from './project-schema-identity.ts';
import { parseOpaqueScapeProjectDocument } from './scape-project-document.ts';
import { confirmFileSizeWarning, type FileSizeWarningOptions } from './controller/shared/file-size-warning.ts';
import { PHOTO_CATALOG_PACK_ASSET_KIND } from './scape-photo-catalog-pack.ts';
import { PHOTO_STACK_PACK_ASSET_KIND } from './scape-photo-stack-pack.ts';
import { PHOTO_SMART_COLLECTION_PACK_ASSET_KIND } from './scape-photo-smart-collection-pack.ts';
import { PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND } from './scape-photo-develop-preset-pack.ts';
import { PHOTO_CUBE_LUT_ASSET_KIND } from './scape-photo-cube-lut.ts';
import { PHOTO_MASK_RASTER_ASSET_KIND_V1 } from './scape-photo-mask-raster-v1.ts';
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
				resolveAssetKinds: (identity, additional) => allowedAssetKinds(additional, identity.schemaFamily),
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

function allowedAssetKinds(additional: readonly string[], family: ProjectSchemaFamily): ReadonlySet<string> {
	if (!Array.isArray(additional) || additional.length > 64) {
		throw new TypeError('Additional Scape asset kinds must be a bounded array.');
	}
	const result = new Set(['audio', 'video', 'video-timing']), registered = new Set<string>();
	if (family === 'lightscaper') result.add(PHOTO_CATALOG_PACK_ASSET_KIND);
	if (family === 'lightscaper') result.add(PHOTO_STACK_PACK_ASSET_KIND);
	if (family === 'lightscaper') result.add(PHOTO_SMART_COLLECTION_PACK_ASSET_KIND);
	if (family === 'lightscaper') result.add(PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND);
	if (family === 'lightscaper') result.add(PHOTO_CUBE_LUT_ASSET_KIND);
	if (family === 'lightscaper') result.add(PHOTO_MASK_RASTER_ASSET_KIND_V1);
	for (const kind of additional) {
		if (typeof kind !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(kind)) {
			throw new TypeError(`An additional Scape asset kind is invalid: ${String(kind)}.`);
		}
		if (registered.has(kind)) throw new Error(`Duplicate Scape asset kind: ${kind}.`);
		registered.add(kind);
		// Frame always registers this shared kind. For an opaque Sound envelope
		// it grants nothing; for Light it is already intrinsic. Actual Sound
		// mask descriptors still fail the manifest's allowed-kind check.
		if (kind === PHOTO_MASK_RASTER_ASSET_KIND_V1 && family !== 'framescaper') continue;
		if (result.has(kind)) throw new Error(`Duplicate Scape asset kind: ${kind}.`);
		// The selected Frame image extension independently closes and authenticates
		// Source3 mask declarations; catalog/preset/root kinds keep their own family.
		if (family === 'framescaper' && kind === PHOTO_MASK_RASTER_ASSET_KIND_V1) { result.add(kind); continue; }
		if (kind === PHOTO_CATALOG_PACK_ASSET_KIND || kind === PHOTO_STACK_PACK_ASSET_KIND
			|| kind === PHOTO_SMART_COLLECTION_PACK_ASSET_KIND || kind === PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND
			|| kind === PHOTO_CUBE_LUT_ASSET_KIND || kind === PHOTO_MASK_RASTER_ASSET_KIND_V1) {
			throw new TypeError('Photo catalog packs require their registered project family.');
		}
		result.add(kind);
	}
	return result;
}
