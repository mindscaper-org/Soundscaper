/* SPDX-License-Identifier: AGPL-3.0-only */
import { formatPresentationMessage } from '../../../i18n/presentation-message.ts';
import type { OnlineMediaFailure } from '../../online-media-failure.ts';
const keys = { 'archive-cancelled': 'projectUploadCancelled', 'archive-invalid': 'projectArchiveInvalid',
	'archive-size': 'projectArchiveTooLarge', 'archive-request': 'projectArchiveRequestFailed',
	'archive-refresh': 'projectArchiveRefreshFailed', authentication: 'connectionError',
	'connection-expired': 'connectionExpired', search: 'searchRequestFailed', preview: 'previewFailed' } as const;
/** Resolve against the opt-in panel's current, lazily loaded copy. */
export function onlineMediaFailureText(failure: OnlineMediaFailure, copy: Readonly<Record<string, string>>): string {
	const key = failure.reason === 'search' && failure.status !== undefined ? 'searchRequestHttpFailed' : keys[failure.reason];
	return formatPresentationMessage(copy, { key, parameters: { status: failure.status ?? '' } });
}
