/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { admitAudioExportDelivery } from '../src/common/editor/controller/export/internal/audio/audio-export-delivery-admission.ts';
import { normalizeEditorExportSettings } from '../src/common/editor/controller/export/export-settings.ts';
import { createExportRenderProject } from '../src/common/editor/controller/export/export-render-project.ts';
import { createExportPlan } from '../src/common/editor/export.js';

for (const emptyPrimary of [false, true]) test(`mastering delivery retains its owning secondary sequence (empty primary:${emptyPrimary})`, () => {
	const ids = emptyPrimary ? ['cut'] : ['main', 'cut'];
	const project = createSoundscaperProject({ id: `secondary-mastering-${String(emptyPrimary)}`, masterChannels: 1,
		primarySequenceId: 'main', sequences: [{ id: 'main', trackIds: emptyPrimary ? [] : ['main-track'] }, { id: 'cut', trackIds: ['cut-track'] }],
		sources: ids.map(id => createAudioSource({ id: `${id}-source`, frameCount: 48_000, channelCount: 1, sampleRate: 48_000 })),
		clips: ids.map(id => createAudioClip({ id: `${id}-clip`, sourceId: `${id}-source`, durationFrames: 48_000, sourceDurationFrames: 48_000 })),
		tracks: ids.map(id => createAudioTrack({ id: `${id}-track`, clipIds: [`${id}-clip`] })),
		timelineAnnotations: ids.map(id => ({ id: `${id}-region`, sequenceId: id, name: `${id} region`, kind: 'region', anchor: 'sample',
			startFrame: 0, endFrame: 24_000, color: 'auto', batchId: null, opaqueExtensions: {} })),
		masteringSequences: [{ id: 'cut-order', sequenceId: 'cut', name: 'Cut order', entries: [{ id: 'entry', annotationId: 'cut-region' }] }],
	});
	const runtime = { getProject: () => project, hasMissingTimelineSources: () => false,
		normalizeExportSettings: (value: Readonly<Record<string, unknown>>) => normalizeEditorExportSettings(value, 48_000) };
	const admission = admitAudioExportDelivery(runtime, { format: 'wav', masteringSequenceId: 'cut-order' });
	// Narrow the legacy admission port to this fixture's native project shape.
	const delivered = admission.deliveredProject as typeof project;
	assert.equal(admission.hasMaterial, true, 'an empty primary timeline cannot hide a deliverable secondary order');
	assert.equal(delivered.primarySequenceId, 'cut');
	assert.deepEqual(delivered.tracks.map(track => track.id), ['cut-track']);
	assert.deepEqual(delivered.timelineAnnotations.map(annotation => annotation.id), ['cut-region']);
	const rendering = createExportRenderProject(delivered);
	assert.deepEqual(rendering.clips.map(clip => clip.id), ['cut-clip'], 'a second render projection must retain the selected owner');
	const plan = createExportPlan(rendering, { format: 'wav', masteringSequenceId: 'cut-order' });
	assert.equal(plan.outputFrames, 24_000);
	assert.equal(project.primarySequenceId, 'main', 'delivery cannot change the authored programme');
	const ordinary = admitAudioExportDelivery(runtime, { format: 'wav' }).deliveredProject as typeof project;
	assert.equal(ordinary.primarySequenceId, 'main');
	assert.deepEqual(ordinary.tracks.map(track => track.id), emptyPrimary ? [] : ['main-track']);
});
