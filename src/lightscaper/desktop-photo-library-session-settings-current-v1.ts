/* SPDX-License-Identifier: AGPL-3.0-only */

import { photoImportIntentKeyV1, normalizePhotoImportIntentV1 } from './import/import-intent-v1.ts';
import { photoImportPresetsKeyV1, normalizePhotoImportPresetRowV1 } from './storage/photo-import-presets-v1.ts';
import { photoDevelopPresetsKeyV1 } from './storage/photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from './storage/photo-develop-preset-row-current-v1.ts';
import { photoExportPresetsKeyV1, normalizePhotoExportPresetRowForProfileV1 } from './storage/internal/photo-raster-export-presets-kernel-v1.ts';
import { photoRasterExportJournalKeyV1, normalizePhotoRasterExportJournalForProfileV1 } from './storage/internal/photo-raster-export-journal-kernel-v1.ts';
import { id } from './catalog/value-validation.ts';

export type DesktopPhotoSessionSettingsDomainCurrentV1 = 'import-intent' | 'develop-presets' | 'export-presets' | 'export-journal' | 'import-presets';
export function readDesktopPhotoSessionSettingsDomainCurrentV1(value: unknown): DesktopPhotoSessionSettingsDomainCurrentV1 {
	if (value !== 'import-intent' && value !== 'develop-presets' && value !== 'export-presets' && value !== 'export-journal' && value !== 'import-presets') throw new TypeError('Unknown fixed native Photo settings domain.');
	return value;
}
export function desktopPhotoSessionSettingsKeyCurrentV1(catalogId: string, value: unknown): string {
	const catalog = id(catalogId, 'Session settings catalog'), domain = readDesktopPhotoSessionSettingsDomainCurrentV1(value);
	switch (domain) {
		case 'import-intent': return photoImportIntentKeyV1(catalog);
		case 'develop-presets': return photoDevelopPresetsKeyV1(catalog);
		case 'export-presets': return photoExportPresetsKeyV1(catalog);
		case 'export-journal': return photoRasterExportJournalKeyV1(catalog);
		case 'import-presets': return photoImportPresetsKeyV1(catalog);
	}
}
export function desktopPhotoSessionSettingsMaximumEncodedBytesCurrentV1(value: unknown): number {
	const domain = readDesktopPhotoSessionSettingsDomainCurrentV1(value);
	if (domain === 'import-intent') return 4096;
	// Native V8 framing is not the domain's UTF8 JSON grammar. Eight bytes per
	// logical JSON byte plus 64KiB covers tagged scalar/container overhead and
	// UTF16 strings without narrowing any admitted Current row. SQL bounds the
	// opaque frame BEFORE decode; owning grammar still runs after it.
	const logical = domain === 'export-presets' ? 65_536 : domain === 'export-journal' ? 1_048_576 : 10_485_760;
	return logical * 8 + 65_536;
}
/** Validate without replacing raw input: canonical CAS preserves property order. */
export function assertDesktopPhotoSessionSettingsValueCurrentV1(value: unknown, catalogId: string, domainValue: unknown): void {
	const domain = readDesktopPhotoSessionSettingsDomainCurrentV1(domainValue);
	switch (domain) {
		case 'import-intent': normalizePhotoImportIntentV1(value, catalogId); return;
		case 'import-presets': normalizePhotoImportPresetRowV1(value, catalogId); return;
		case 'develop-presets': normalizePhotoDevelopPresetRowCurrentV1(value, catalogId); return;
		case 'export-presets': normalizePhotoExportPresetRowForProfileV1('current1', value, catalogId); return;
		case 'export-journal': {
			const normalized = normalizePhotoRasterExportJournalForProfileV1('current3', value);
			if (normalized.catalogId !== catalogId) throw new TypeError('Export journal belongs to another selected catalog.');
			return;
		}
	}
}
