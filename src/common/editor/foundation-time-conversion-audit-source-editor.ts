/* SPDX-License-Identifier: AGPL-3.0-only */

import { deepFreezeAuditSites } from './foundation-audit-site-freeze.ts';
import type { FoundationTimeConversionSite } from './foundation-time-conversion-audit.ts';

/** Source editor display and authoring share the owning project tempo and sample grid. */
export const FOUNDATION_TIME_CONVERSION_SOURCE_EDITOR_SITES: readonly FoundationTimeConversionSite[] = deepFreezeAuditSites([
	{
		id: 'm4a-chapter-region-admission',
		file: 'src/common/editor/export-embedded-chapter-encoding.ts',
		behavior: 'M4A chapter admission uses the chapter resolver’s nearest-sample nominal endpoint when no actual rendered delivery length is supplied, so unsupported independent ends are refused against the same output clock.',
		conversions: [{ helper: 'scaleSampleFrame', policies: ['point'] }],
	},
	{
		id: 'source-selection-native-format-rewrite',
		file: 'src/common/editor/controller/effects/internal/source-editor-effects.ts',
		behavior: 'A source-format rewrite maps each selected native-frame boundary through its exact retained source-clock ratio and rounds once to the nearest destination source frame; inverse mappings preserve the selection through Undo and Redo.',
		conversions: [{ helper: 'roundRational', policies: ['point'] }],
	},
	{
		id: 'midi-warp-note-growth-extent',
		file: 'src/common/editor/controller/track-audio/internal/midi-warp-note-growth.ts',
		behavior: 'MIDI note growth preserves authored warp anchors and rounds its positive final-segment continuation outward to the enclosing sample endpoint; musical extents retain exact rational beats.',
		conversions: [{ helper: 'roundRational', policies: ['enclosingEnd'] }],
	},
	{
		id: 'midi-source-warp-delivery',
		file: 'src/common/editor/midi-project-source-projection.ts',
		behavior: 'MIDI delivery maps source events through the authored warp, rounding musical beat positions and sample-domain warp offsets once to the nearest project sample.',
		conversions: [{ helper: 'beatToSampleFrame', policies: ['point'] }, { helper: 'roundRational', policies: ['point'] }],
	},
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
