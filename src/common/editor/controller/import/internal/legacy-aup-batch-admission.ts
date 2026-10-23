/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError } from '../../../../i18n/presentation-message.ts';
import { publishedCopyFor } from '../../shared/presentation-localization.ts';

/** A legacy project and its companion blocks form one import transaction. */
export function assertSingleLegacyAupProject<FileType>(
	files: readonly FileType[],
	isLegacyAupFile: (file: FileType) => boolean,
	copy: object,
): void {
	if (files.filter(isLegacyAupFile).length > 1) {
		throw createLocalizedError(TypeError, publishedCopyFor(copy), 'multipleLegacyAupProjects');
	}
}
