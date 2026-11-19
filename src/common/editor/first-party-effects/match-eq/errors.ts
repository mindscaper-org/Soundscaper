/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError } from '../../../i18n/presentation-message.ts';
import { MATCH_EQ_COPY } from '../../../i18n/editor-match-eq-copy.ts';

export function matchEqError(key: 'effectMatchEqReferenceMissing' | 'effectMatchEqTooShort' | 'effectMatchEqSilent'): RangeError & { readonly code: string } {
	return Object.assign(createLocalizedError(RangeError, MATCH_EQ_COPY, key), { code: key });
}
