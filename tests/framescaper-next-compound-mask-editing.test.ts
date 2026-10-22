/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperVisualInspectorModel, createFramescaperVisualInspectorCommand } from '../src/common/editor/ui/framescaper-visual-inspector-model.ts';
import { createFramescaperSelectedVisualAuthoringModelFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import { prepareFramescaperSelectedVisualAuthoringFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-commands.ts';
import { normalizeVideoMaskMatteGraphV1 } from '../src/common/editor/video-mask-matte-v24.ts';

function project(outputNodeId: string) {
	return createFramescaperProject(PROFILE, { id: 'compound-mask',
		visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'source', name: 'Masked title',
			width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 150,
			generator: { kind: 'solid', color: '#ffffffff' } }], maskMattes: [{ schemaVersion: 1, id: 'compound', kind: 'mask', inputs: [],
			nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
				{ id: 'inverse', kind: 'invert', inputNodeId: 'shape' }], outputNodeId }] },
		clips: [{ schemaVersion: 1, kind: 'generator', id: 'masked', sourceId: 'source', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['masked'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main',
		finishing: { visualPresentations: [{ schemaVersion: 1, id: 'view', owner: { kind: 'clip', id: 'masked' }, enabled: true,
			opacity: 1, blendMode: 'normal', grade: null, processorStackId: null, maskMatteIds: ['compound'] }] },
	});
}

for (const output of ['shape', 'inverse']) test(`opacity preserves the complete ${output} mask graph`, () => {
	const original = project(output), model = createFramescaperVisualInspectorModel({ project: original, selectedClipId: 'masked' });
	const command = createFramescaperVisualInspectorCommand(original, 'masked', { generator: model.generator, opacity: 0.5,
		blendMode: model.blendMode, maskId: model.maskId, maskWidth: model.maskWidth, presetId: null });
	const updated = applyFramescaperProjectCommand(PROFILE, original, command);
	assert.deepEqual(updated.videoMaskMattes, original.videoMaskMattes);
});

test('simple shape authoring never flattens an admitted invert graph', async () => {
	const original = project('inverse');
	const model = createFramescaperSelectedVisualAuthoringModelFinishing({ project: original, surface: 'video-mask-matte',
		selectedClipId: 'masked', playheadSample: 0 });
	await assert.rejects(() => prepareFramescaperSelectedVisualAuthoringFinishing({
		project: original, surface: 'video-mask-matte', store: createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false }),
		request: { fence: model.fence, operation: 'apply', clipId: 'masked', maskId: 'compound', shape: 'ellipse', width: 0.8, height: 0.8 },
	}), /not editable/u);
});

test('updating an editable shape preserves its position and remaining graph nodes', async () => {
	const original = project('shape');
	const model = createFramescaperSelectedVisualAuthoringModelFinishing({ project: original, surface: 'video-mask-matte', selectedClipId: 'masked', playheadSample: 0 });
	const prepared = await prepareFramescaperSelectedVisualAuthoringFinishing({ project: original, surface: 'video-mask-matte',
		store: createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false }),
		request: { fence: model.fence, operation: 'apply', clipId: 'masked', maskId: 'compound', shape: 'ellipse', width: 0.8, height: 0.7 },
	});
	const updated = applyFramescaperProjectCommand(PROFILE, original, prepared.command);
	assert.ok(Array.isArray(updated.videoMaskMattes)); const mask = normalizeVideoMaskMatteGraphV1(updated.videoMaskMattes[0]);
	assert.deepEqual(mask, { schemaVersion: 1, id: 'compound', kind: 'mask', inputs: [], outputNodeId: 'shape', nodes: [
		{ id: 'inverse', kind: 'invert', inputNodeId: 'shape' },
		{ id: 'shape', kind: 'vector-shape', shape: 'ellipse', x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
	] });
});

for (const operation of ['remove', 'apply']) test(`compound mask remains removable or replaceable with a fresh attachment: ${operation}`, async () => {
	const original = project('inverse');
	const model = createFramescaperSelectedVisualAuthoringModelFinishing({ project: original, surface: 'video-mask-matte', selectedClipId: 'masked', playheadSample: 0 });
	const prepared = await prepareFramescaperSelectedVisualAuthoringFinishing({ project: original, surface: 'video-mask-matte',
		store: createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false }),
		request: { fence: model.fence, operation, clipId: 'masked', maskId: operation === 'remove' ? 'compound' : null,
			shape: 'ellipse', width: 0.8, height: 0.7 },
	});
	const updated = applyFramescaperProjectCommand(PROFILE, original, prepared.command);
	assert.ok(Array.isArray(updated.videoMaskMattes));
	if (operation === 'remove') assert.equal(updated.videoMaskMattes.length, 0);
	else {
		assert.equal(updated.videoMaskMattes.length, 2);
		assert.deepEqual(updated.videoMaskMattes.map(normalizeVideoMaskMatteGraphV1).find(value => value.id === 'compound'),
			Array.isArray(original.videoMaskMattes) ? original.videoMaskMattes[0] : null);
	}
});
