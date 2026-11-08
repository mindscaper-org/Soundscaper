/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportPlan } from '../src/common/editor/export.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

function project(spans: readonly (readonly [number, number])[]) {
	return createCurrentAudioEditorProject({ id: 'chapter-regions', sampleRate: 48_000,
		sources: [{ id: 'source', frameCount: 48_000, channelCount: 1, sampleRate: 48_000 }],
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0,
			sourceDurationFrames: 48_000, durationFrames: 48_000 }],
		tracks: [{ id: 'audio', type: 'audio', clipIds: ['clip'] }, { id: 'labels', type: 'label',
			labels: spans.map(([startFrame, endFrame], index) => ({ id: `label-${index}`, startFrame, endFrame, title: `Region ${index + 1}` })) }],
	});
}

test('M4A chapter preflight refuses region ends its start-only metadata cannot preserve', () => {
	for (const spans of [[[0, 12_000], [24_000, 48_000]], [[0, 36_000], [24_000, 48_000]],
		[[0, 12_000]], [[0, 24_000], [0, 48_000]]] as const) {
		const admitted = project(spans);
		assert.throws(() => createExportPlan(admitted, { format: 'aac-m4a', embedLabelChapters: true, includeTail: false }),
			/M4A.*chapter.*end|chapter.*end.*M4A/u);
		const ordinary = createExportPlan(admitted, { format: 'aac-m4a', embedLabelChapters: false, includeTail: false });
		assert.equal('embeddedChapters' in ordinary.encoding, false);
		const mp3 = createExportPlan(admitted, { format: 'mp3', embedLabelChapters: true, includeTail: false });
		assert.equal(mp3.encoding.embeddedChapters?.[0]?.endFrame, spans[0][1]);
	}
});

test('M4A chapters preserve contiguous regions ending at the delivered audio bound', () => {
	const plan = createExportPlan(project([[12_000, 24_000], [24_000, 48_000]]), {
		format: 'aac-m4a', embedLabelChapters: true, includeTail: false, sampleRate: 24_000,
	});
	assert.deepEqual(plan.encoding.embeddedChapters, [
		{ startFrame: 6000, endFrame: 12_000, title: 'Region 1' },
		{ startFrame: 12_000, endFrame: 24_000, title: 'Region 2' },
	]);
	assert.equal(plan.encoding.embeddedChapters?.at(-1)?.endFrame, plan.outputFrames);
});
