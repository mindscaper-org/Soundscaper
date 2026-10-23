/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { normalizeVideoColorGradeV1 } from '../src/common/editor/video-color-management-v27.ts';
import { exportProjectEdl, exportProjectOtio, exportProjectFcpxml } from '../src/common/editor/controller/export/interchange-export-action.ts';

const modes = ['mask', 'source-mask', 'layer-mask', 'opacity', 'blend', 'grade', 'processor',
	'neutral', 'unbound', 'disabled', 'hidden', 'disabled-processor', 'empty-processor',
	'layer-after', 'layer-before', 'layer-other-track', 'layer-other-sequence'] as const;
type Mode = typeof modes[number];
for (const [format, action] of [['edl', exportProjectEdl], ['otio', exportProjectOtio], ['fcpxml', exportProjectFcpxml]] as const) {
	for (const mode of modes) test(`${format} inventories only operative native finishing: ${mode}`, async () => {
		const project = fixture(mode), before = structuredClone(project); const files: Blob[] = [];
		const state: { deliveryReport?: unknown } = {};
		const result = await action({ getProject: () => project, state,
			fileService: { saveFile(request) { assert.ok(request.blob instanceof Blob); files.push(request.blob); } } });
		assert.ok(result); assert.equal(files.length, 1); assert.equal(await files[0]?.text(), result.text);
		const warnings = result.report.items.filter(item => item.code === `${format}.picture-processing-omitted`);
		const operative = ['mask', 'source-mask', 'layer-mask', 'opacity', 'blend', 'grade', 'processor'].includes(mode);
		assert.equal(warnings.length, operative ? 1 : 0, 'a retained cut must disclose its active native finishing without warning about dormant state');
		if (operative) {
			assert.deepEqual(warnings[0]?.scope, { kind: 'clip', id: 'take' });
			assert.equal(warnings[0]?.disposition, 'omitted'); assert.equal(warnings[0]?.severity, 'warning');
			assert.deepEqual(warnings[0]?.data, mode.endsWith('mask') ? { videoMaskMattes: ['crop'] }
				: mode === 'grade' ? { videoColorGrades: ['presentation'] }
					: mode === 'processor' ? { videoProcessorStacks: ['stack'] } : { videoVisualPresentations: ['presentation'] });
		}
		assert.equal(state.deliveryReport, result.report); assert.deepEqual(project, before);
	});
}

function fixture(mode: Mode) {
	const layer = mode.startsWith('layer-');
	return createFramescaperProject(PROFILE, { id: 'masked-camera', primarySequenceId: 'main',
		sources: [createVideoSource({ id: 'camera', name: 'Camera.webm', storageKey: 'camera.webm', mimeType: 'video/webm', contentSha256: '12'.repeat(32),
			sampleFrameCount: 96_000, sourceFrameCount: 50, frameRate: { num: 25, den: 1 }, width: 320, height: 180 })],
		clips: [{ kind: 'video', id: 'take', title: 'Take', sourceId: 'camera', sequenceId: 'main', sequenceStartFrame: mode === 'layer-before' ? 25 : 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25 }],
		tracks: [{ type: 'video', id: 'picture', name: 'Picture', clipIds: ['take'], hidden: mode === 'hidden' },
			{ type: 'video', id: 'other', name: 'Other', clipIds: [] }, { type: 'video', id: 'secondary', name: 'Secondary', clipIds: [] }],
		sequences: [{ id: 'main', rate: { num: 25, den: 1 }, trackIds: ['picture', 'other'] }, { id: 'second', rate: { num: 25, den: 1 }, trackIds: ['secondary'] }],
		visualModel: { maskMattes: [{ schemaVersion: 1, id: 'crop', kind: 'mask', inputs: [],
			nodes: [{ id: 'rectangle', kind: 'vector-shape', shape: 'rectangle', x: .25, y: .25, width: .5, height: .5 }], outputNodeId: 'rectangle' }],
			adjustmentLayers: layer ? [{ schemaVersion: 1, kind: 'adjustment-layer', id: 'layer', sequenceId: mode === 'layer-other-sequence' ? 'second' : 'main',
				sequenceStartFrame: mode === 'layer-after' ? 25 : 0, sequenceFrameCount: 25,
				targetTrackIds: [mode === 'layer-other-track' ? 'other' : mode === 'layer-other-sequence' ? 'secondary' : 'picture'], effectIds: [] }] : [] },
		finishing: { visualPresentations: mode === 'unbound' ? [] : [{ schemaVersion: 1, id: 'presentation',
			owner: { kind: layer ? 'adjustment-layer' : mode === 'source-mask' ? 'source' : 'clip', id: layer ? 'layer' : mode === 'source-mask' ? 'camera' : 'take' },
			enabled: mode !== 'disabled', opacity: mode === 'opacity' ? .5 : 1, blendMode: mode === 'blend' ? 'multiply' : 'normal',
			grade: mode === 'grade' ? { ...normalizeVideoColorGradeV1(), exposureStops: 1 } : null,
			processorStackId: mode.includes('processor') ? 'stack' : null,
			maskMatteIds: ['neutral', 'opacity', 'blend', 'grade', 'processor', 'disabled-processor', 'empty-processor'].includes(mode) ? [] : ['crop'] }],
			processorStacks: mode.includes('processor') ? [{ schemaVersion: 1, id: 'stack', sourceId: 'camera',
				processors: mode === 'empty-processor' ? [] : [{ schemaVersion: 1, id: 'denoise', kind: 'spatial-denoise', enabled: mode !== 'disabled-processor', radius: 1, strength: .5 }] }] : [] },
	});
}
