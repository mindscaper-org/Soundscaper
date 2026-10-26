/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportChapterCount, resolveExportChapters } from '../src/common/editor/export-chapters.ts';
import { createExportPlan } from '../src/common/editor/export.js';

for (const musical of [true, false]) {
	test(`chapter output admission agrees with the delivered ${musical ? 'musical' : 'sample'} label`, () => {
		const source = createAudioSource({ id: 'take', sampleRate: 48_000, frameCount: 192_000, channelCount: 1 });
		const project = createSoundscaperProject({ id: 'musical-chapter', sampleRate: 48_000,
			tempoMap: { mode: 'musical', events: [
				{ id: 'head', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
				{ id: 'change', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
			] }, sources: [source], clips: [createAudioClip({ id: 'clip', sourceId: source.id,
				durationFrames: 192_000, sourceDurationFrames: 192_000 })], tracks: [
				createAudioTrack({ id: 'voice', clipIds: ['clip'] }),
				{ id: 'labels', type: 'label', name: 'Chapters', labels: [{ id: 'span', title: 'Across change',
					...(musical ? { anchor: 'musical', startBeat: { num: 3, den: 1 }, endBeat: { num: 5, den: 1 } }
						: { startFrame: 72_000, endFrame: 144_000 }) }] },
			] });
		const before = structuredClone(project);
		const plan = createExportPlan(project, { format: 'wav', mode: 'chapters', range: 'project', includeTail: false });
		assert.equal(plan.outputs.length, 1, 'the existing exporter can already deliver this chapter');
		assert.equal(exportChapterCount(project), 1, 'the ordinary export dialog must offer that deliverable output');
		const chapters = resolveExportChapters(project, { startFrame: 0, endFrame: 192_000 });
		assert.deepEqual(chapters.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [[72_000, 144_000]]);
		assert.deepEqual(project, before, 'presentation must retain authored beat authority');
	});
}
