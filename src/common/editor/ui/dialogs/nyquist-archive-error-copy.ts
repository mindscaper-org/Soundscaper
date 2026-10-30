/* SPDX-License-Identifier: AGPL-3.0-only */
import { nyquistArchiveFailure } from '../../nyquist/archive-failure.ts';
import { formatLocalizedTemplate } from '../localization-template.ts';

export function nyquistArchiveErrorLabel(error: unknown, operation: 'download' | 'install' | 'remove', copy: Readonly<Record<string, string>>): string {
	const failure = nyquistArchiveFailure(error);
	const key = failure?.reason ?? (operation === 'download' ? 'downloadFailed' : operation === 'install' ? 'installFailed' : 'removeFailed');
	return formatLocalizedTemplate(copy[key] ?? copy.downloadFailed!, { status: failure?.status ?? '' });
}
