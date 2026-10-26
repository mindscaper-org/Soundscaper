/* SPDX-License-Identifier: AGPL-3.0-only */
import type { FoundationRuntimeConsumerEvidence } from './foundation-runtime-consumer-evidence.ts';

/** Label presentation, selected spans and track-header ranges own native timing boundaries. */
export const FOUNDATION_SELECTION_RUNTIME_CONSUMERS: readonly FoundationRuntimeConsumerEvidence[] = [
	{
		id: 'native-clip-join-availability', surface: 'timeline', file: 'src/common/editor/commands/clip-join-availability.ts',
		entryPoint: 'clipJoinAvailabilityProject', inputIdentifier: 'project', projectedIdentifier: 'clips', boundary: 'resolveRuntimeClipProjection',
		evidence: 'Join preflight resolves selected musical audio timing before measuring adjacency; command mutation retains the authored timing authority.',
	},
	{
		id: 'label-manager-presentation', surface: 'timeline', file: 'src/common/editor/ui/workspace/WorkspacePanelContent.jsx',
		entryPoint: 'WorkspacePanelContent', inputIdentifier: 'labelInput', projectedIdentifier: 'labelProject', boundary: 'resolveRuntimeProjectProjection',
		evidence: 'Manage labels uses the supplied runtime project or resolves a label-only authored view before passing sample positions to its timecode controls; label edits retain the persisted beat authority.',
	},
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
