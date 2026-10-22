/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLightscaperFileSaveServiceCurrentV1, type LightscaperFileSaveServiceOptionsCurrentV1 } from './photo-file-save-service-current-v1.ts';
import { maximumPhotoCatalogStreamingOutputBytesV3 } from './archive/catalog-archive-capacity.ts';

/** File-menu opt-in composition. Catalog authority stays with the existing session. */
export function createPhotoLibraryBackupSaveRuntimeV1(options: LightscaperFileSaveServiceOptionsCurrentV1 = {}) {
	const files = createLightscaperFileSaveServiceCurrentV1(options);
	return Object.freeze({ prepareSave: files.prepareSave, saveFile: files.saveFile,
		maximumStreamingBytes: maximumPhotoCatalogStreamingOutputBytesV3() });
}
