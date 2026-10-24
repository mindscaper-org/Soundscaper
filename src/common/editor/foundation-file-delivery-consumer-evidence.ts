/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FoundationRuntimeConsumerEvidence } from './foundation-runtime-consumer-evidence.ts';

export const FOUNDATION_FILE_DELIVERY_RUNTIME_CONSUMERS: readonly FoundationRuntimeConsumerEvidence[] = Object.freeze([
	{
		id: 'audio-source-readiness', surface: 'audio-export', file: 'src/common/editor/controller/export/audio-export-source-inventory.ts',
		entryPoint: 'audioExportSourceInventory', inputIdentifier: 'project', projectedIdentifier: 'resolved', boundary: 'projectForRuntimeConsumers',
		evidence: 'Audio source readiness resolves authored clip timing before excluding strictly future inputs from a selected output span; earlier inputs and full-project scalar cache dependencies remain available without changing the delivered render project.',
	},
	{
		id: 'label-file-export', surface: 'interchange', file: 'src/common/editor/controller/edit/internal/label-service.ts',
		entryPoint: 'exportLabels', inputIdentifier: 'labelProject', projectedIdentifier: 'tracks', boundary: 'resolveRuntimeProjectProjection',
		evidence: 'Label file export resolves the label-only authored project through its tempo map before selecting tracks and serializing subtitle or chapter sample times.',
	},
	{
		id: 'chapter-output-delivery-range', surface: 'audio-export', file: 'src/common/editor/export-chapters.ts',
		entryPoint: 'chapterDeliveryRange', inputIdentifier: 'projectValue', projectedIdentifier: 'endFrame', boundary: 'projectDurationFrames',
		evidence: 'Chapter availability delegates its programme extent to the registered project duration boundary, whose runtime projection resolves authored clip ends before selecting the delivered range.',
	},
	{
		id: 'chapter-output-musical-labels', surface: 'audio-export', file: 'src/common/editor/export-chapters.ts',
		entryPoint: 'labelTrackBoundaries', inputIdentifier: 'project', projectedIdentifier: 'resolved', boundary: 'resolveRuntimeTrackProjection',
		evidence: 'Chapter output availability resolves authored musical label boundaries through the current tempo before counting or writing chapter sample intervals.',
	},
	{
		id: 'freesound-clip-upload-geometry', surface: 'audio-export',
		file: 'src/common/editor/controller/track-audio/internal/freesound-clip-upload-materializer.ts',
		entryPoint: 'locateClip', inputIdentifier: 'project', projectedIdentifier: 'clip', boundary: 'resolveRuntimeClipProjection',
		evidence: 'Clip upload admission resolves persisted musical geometry before checking or rendering its sample range; authored source and document coordinates remain unchanged.',
	},
	{
		id: 'freesound-bin-upload-time-pitch', surface: 'audio-export',
		file: 'src/common/editor/controller/track-audio/internal/freesound-clip-upload-materializer.ts',
		entryPoint: 'createIsolatedFreesoundClipRenderProject', inputIdentifier: 'project', projectedIdentifier: 'binClip', boundary: 'clipTimePitchPlaybackProjection',
		evidence: 'A musical Bin upload retains its resolved independent time-pitch scalar before detaching its authored beat anchor and placing the private render at zero.',
	},
]);
