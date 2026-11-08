/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { evaluateClipFadeAt } from '../src/common/editor/audio-clip-transition-gain.ts';

function project(edge: 'in' | 'out', shape: number | undefined) {
	return createCurrentAudioEditorProject({ id: 'fades', sampleRate: 8000,
		sources: [{ id: 'source', name: 'Voice.wav', storageKey: 'source', frameCount: 8000, channelCount: 1, sampleRate: 8000, originalSampleRate: 8000, sampleFormat: 'float32', chunkFrames: 8000 }],
		tracks: [{ type: 'audio', id: 'voice', name: 'Voice', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: 'source', title: 'Voice', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 8000, durationFrames: 8000,
			...(edge === 'in' ? { fadeInFrames: 3200, ...(shape === undefined ? {} : { fadeInShape: shape }) }
				: { fadeOutFrames: 3200, ...(shape === undefined ? {} : { fadeOutShape: shape }) }) }] });
}

for (const edge of ['in', 'out'] as const) test(`DAWproject discloses a constant-power fade-${edge} that reimports as linear`, () => {
	const authored = project(edge, 1); assert.ok(validateAudioEditorProjectV17(authored));
	const output = createDawprojectExport({ project: { ...authored } });
	let id = 0;
	const imported = buildDawprojectProject(parseDawprojectDocument(output.projectXml, output.metadataXml), {
		sampleRate: 8000, createStableId: prefix => `${prefix}-${++id}`,
		media: new Map(output.media.map(entry => [entry.path, { sampleRate: 8000, channelCount: 1, frameCount: 8000 }])) });
	const reopened = createCurrentAudioEditorProject(imported.project); assert.ok(validateAudioEditorProjectV17(reopened));
	const clip = reopened.clips[0]!; assert.ok(typeof clip.durationFrames === 'number');
	const frame = edge === 'in' ? 800 : clip.durationFrames - 800;
	const shape = edge === 'in' ? clip.fadeInShape : clip.fadeOutShape;
	assert.equal(shape, undefined);
	assert.equal(evaluateClipFadeAt(frame, clip.durationFrames, 3200, edge, shape), 0.25);
	assert.ok(Math.abs(evaluateClipFadeAt(frame, clip.durationFrames, 3200, edge, 1) - 0.3826834323650898) < 1e-12);
	const omission = output.report.items.find(item => item.code === 'dawproject.clip-features-omitted');
	assert.deepEqual(omission?.data.features, [edge === 'in' ? 'fadeInShape' : 'fadeOutShape']);
});

for (const shape of [undefined, 2, 0.5]) test(`DAWproject keeps the existing omission policy for ${shape ?? 'linear'} fade shape`, () => {
	const output = createDawprojectExport({ project: { ...project('in', shape) } });
	assert.match(output.projectXml, /fadeInTime="0\.4"/u);
	const omission = output.report.items.find(item => item.code === 'dawproject.clip-features-omitted');
	if (shape === undefined) assert.equal(omission, undefined);
	else assert.deepEqual(omission?.data.features, ['fadeInShape']);
});
