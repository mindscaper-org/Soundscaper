/* SPDX-License-Identifier: AGPL-3.0-only */

import { deepFreezeAuditSites } from './foundation-audit-site-freeze.ts';
import type { FoundationTimeConversionSite } from './foundation-time-conversion-audit.ts';

/** Source editor display and authoring share the owning project tempo and sample grid. */
export const FOUNDATION_TIME_CONVERSION_SOURCE_EDITOR_SITES: readonly FoundationTimeConversionSite[] = deepFreezeAuditSites([
	{
		id: 'capture-native-audio-data-clock',
		file: 'src/common/editor/controller/capture/internal/browser/framescaper-audio-data-frame-clock.ts',
		behavior: 'Native AudioData timestamp deltas round once to the nearest observed native block interval to locate loss across queued delivery. Exact source holes use the native discarded-block counter and fixed observed block size; timestamp jitter never manufactures or changes missing-sample counts.',
		conversions: [{ helper: 'roundRational', policies: ['point'] }],
	},
	{
		id: 'midi-file-import-clock',
		file: 'src/common/editor/midi-file.ts',
		behavior: 'SMF import accumulates exact PPQ microsecond/tick numerators or SMPTE rational frame-rate/tick coordinates, including 30000/1001 fps, then rounds each note, event and conductor point once to its nearest destination sample.',
		conversions: [{ helper: 'roundRational', policies: ['point'] }],
	},
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
		id: 'midi-loop-growth-source-phase',
		file: 'src/common/editor/controller/track-audio/midi-service.ts',
		behavior: 'Growing a MIDI loop period retains the same authored source phase by resolving its exact old/new source-to-period ratio once to the nearest loop-offset frame.',
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
		behavior: 'MIDI delivery retains continuous loop source-window ratios with exact integral cut boundaries, then maps source events through the authored warp and rounds musical beat positions and sample-domain warp offsets once to the nearest project sample.',
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
