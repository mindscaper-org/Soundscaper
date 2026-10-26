/* SPDX-License-Identifier: AGPL-3.0-only */

import { deepFreezeAuditSites } from './foundation-audit-site-freeze.ts';
import type { FoundationTimeConversionSite } from './foundation-time-conversion-audit.ts';

/** Source editor display and authoring share the owning project tempo and sample grid. */
export const FOUNDATION_TIME_CONVERSION_SOURCE_EDITOR_SITES: readonly FoundationTimeConversionSite[] = deepFreezeAuditSites([
	{
		id: 'clip-source-ruler-musical-origin',
		file: 'src/common/editor/ui/inspector/clip-source-ruler-model.ts',
		behavior: 'Source ruler bars reset their label origin at the clip while project tempo and signature changes retain their exact sample positions in local and global views.',
		conversions: [{ helper: 'sampleFrameToBeat', policies: ['exact'] }, { helper: 'beatToSampleFrame', policies: ['point'] }, { helper: 'roundRational', policies: ['directional'] }],
	},
	{
		id: 'clip-source-stretch-marker-feedback',
		file: 'src/common/editor/ui/inspector/clip-source-stretch-feedback.ts',
		behavior: 'Prepared source stretch feedback resolves each authored musical warp anchor once to its nearest project sample before computing adjacent source-to-output speed and editable marker bounds.',
		conversions: [{ helper: 'beatToSampleFrame', policies: ['point'] }],
	},
]);
