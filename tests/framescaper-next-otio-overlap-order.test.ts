/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createDefaultDissolveVideoTransitionV1 } from '../src/common/editor/video-transition-registry.ts';
import { resolveActiveVideoLayers } from '../src/common/editor/video-timeline.js';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { referenceTopClipId } from './helpers/interchange-top-clip.ts';

test('OTIO keeps successive incoming pictures above outgoing pictures throughout an overlap chain', () => {
	const project = createFramescaperProject(PROFILE, { id: 'overlap-export', sampleRate: 48_000,
		sources: [createVideoSource({ id: 'camera', frameRate: { num: 30, den: 1 }, sourceFrameCount: 60,
			sampleFrameCount: 96_000, width: 16, height: 16, storageKey: 'camera.mp4', contentSha256: 'ab'.repeat(32) })],
		clips: ['A', 'B', 'C'].map((id, index) => ({ kind: 'video', id, sourceId: 'camera', sequenceId: 'main',
			sequenceStartFrame: index * 30, sequenceFrameCount: 60, sourceInFrame: 0, sourceFrameCount: 60 })),
		tracks: [createVideoTrack({ id: 'picture', clipIds: ['A', 'B', 'C'] })],
		videoTransitionsByTrackId: { picture: [
			createDefaultDissolveVideoTransitionV1({ id: 'AB', outgoingClipId: 'A', incomingClipId: 'B', durationFrames: 30 }),
			createDefaultDissolveVideoTransitionV1({ id: 'BC', outgoingClipId: 'B', incomingClipId: 'C', durationFrames: 30 }),
		] },
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackNodes: [{ kind: 'track', id: 'picture', parentFolderId: null }] }], primarySequenceId: 'main',
	});
	const runtime = projectForRuntimeConsumers(project as never);
	const layers = resolveActiveVideoLayers(runtime, 120_000);
	assert.deepEqual(layers[0]?.clips.map(({ clipId }: { clipId: string }) => clipId), ['B', 'C']);
	const exported = createOtioExport({ project: runtime as unknown as Readonly<Record<string, unknown>>, sequenceId: 'main', sequenceRate: { num: 30, den: 1 } });
	assert.equal(referenceTopClipId(exported.text, 45, 30), 'B');
	assert.equal(referenceTopClipId(exported.text, 75, 30), 'C', 'a retired lower lane must not put the next incoming clip behind the outgoing clip');
});
