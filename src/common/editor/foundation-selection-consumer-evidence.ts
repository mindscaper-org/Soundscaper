/* SPDX-License-Identifier: AGPL-3.0-only */
import type { FoundationRuntimeConsumerEvidence } from './foundation-runtime-consumer-evidence.ts';

/** Selected label spans and track-header ranges own separate native timing boundaries. */
export const FOUNDATION_SELECTION_RUNTIME_CONSUMERS: readonly FoundationRuntimeConsumerEvidence[] = [
	{
		id: 'selected-track-musical-label-range', surface: 'navigation',
		file: 'src/common/editor/controller/track-audio/internal/selected-track-content-range.ts',
		entryPoint: 'selectedTrackContentRange', inputIdentifier: 'project', projectedIdentifier: 'tracks',
		boundary: 'resolveRuntimeTrackProjection',
		evidence: 'Selected label tracks resolve beat anchors through their owning tempo map before their sample boundaries contribute to the track content extent; unrelated native visual clips retain their own geometry authority.',
	},
	{
		id: 'track-header-musical-range-selection', surface: 'navigation',
		file: 'src/common/editor/ui/timeline/TrackControls.jsx',
		entryPoint: 'TrackControls', inputIdentifier: 'project', projectedIdentifier: null,
		boundary: 'resolveRuntimeProjectProjection',
		evidence: 'Audio track-header double clicks resolve the persisted controller snapshot before the existing pointer range reducer measures musical clip start and end positions.',
	},
];
