/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { selectLabeledAudioRegions, labeledAudioSpanRegions } from '../src/common/editor/labeled-audio-regions.ts';
import { evaluateAudacityActionEnablement } from '../src/common/editor/audacity-action-parity.js';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';

function fixture(bpm = 60) {
	return createSoundscaperProject({ id: 'musical-labeled-admission', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [
			{ id: 'origin', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'change', beat: { num: 4, den: 1 }, bpm: { num: bpm, den: 1 } },
		] },
		tracks: [{ id: 'labels', type: 'label', labels: [
			{ id: 'span', title: 'Across change', anchor: 'musical', startBeat: { num: 3, den: 1 }, endBeat: { num: 5, den: 1 } },
		] }], selection: { startFrame: 0, endFrame: 192_000, trackIds: ['labels'] },
	});
}

test('labeled audio admission resolves authored beats through a tempo change without altering the document', () => {
	const project = fixture(), before = structuredClone(project);
	assert.deepEqual(selectLabeledAudioRegions(project, project.selection), [{ startFrame: 72_000, endFrame: 144_000 }]);
	assert.deepEqual(project, before);
	assert.deepEqual(selectLabeledAudioRegions(project, { startFrame: 72_001, endFrame: 144_000 }), []);
});

test('all labeled menu and shortcut predicates admit the same complete musical region', () => {
	const project = fixture();
	for (const id of ['cut-labels', 'delete-labels', 'split-cut-labels', 'split-delete-labels',
		'silence-labels', 'copy-labels', 'split-labels', 'join-labels', 'disjoin-labels']) {
		assert.equal(evaluateAudacityActionEnablement(id, { snapshot: { project, selectedTrackId: 'labels' } }), true, id);
		assert.equal(evaluateAudacityActionEnablement(id, { snapshot: { project, selectedTrackId: 'labels', readOnly: true } }), false, id);
	}
});

test('tempo changes refresh labeled boundaries and already-resolved command views agree', () => {
	const slow = fixture(), fast = fixture(120);
	assert.deepEqual(selectLabeledAudioRegions(fast, fast.selection), [{ startFrame: 72_000, endFrame: 120_000 }]);
	assert.deepEqual(selectLabeledAudioRegions(slow, slow.selection), [{ startFrame: 72_000, endFrame: 144_000 }]);
	const runtime = resolveRuntimeProjectProjection(slow);
	assert.deepEqual(selectLabeledAudioRegions(runtime, slow.selection), selectLabeledAudioRegions(slow, slow.selection));
});

test('sample-only selected label tracks do not require or read a musical clock', () => {
	const project = { get sampleRate(): number { throw new Error('unused clock'); },
		tracks: [{ id: 'sample', type: 'label', labels: [{ startFrame: 10, endFrame: 20 }] },
			{ id: 'other', type: 'label', labels: [{ anchor: 'musical', startBeat: { num: 1, den: 1 }, endBeat: { num: 2, den: 1 } }] }] };
	assert.deepEqual(selectLabeledAudioRegions(project, { startFrame: 0, endFrame: 30 }, ['sample']), [{ startFrame: 10, endFrame: 20 }]);
});

test('musical point labels remain split boundaries and are excluded from span-only edits', () => {
	const project = createSoundscaperProject({ id: 'musical-point', sampleRate: 48_000,
		tracks: [{ id: 'labels', type: 'label', labels: [{ id: 'point', anchor: 'musical',
			startBeat: { num: 1, den: 1 }, endBeat: { num: 1, den: 1 } }] }] });
	const regions = selectLabeledAudioRegions(project, { startFrame: 0, endFrame: 48_000 });
	assert.deepEqual(regions, [{ startFrame: 24_000, endFrame: 24_000 }]);
	assert.deepEqual(labeledAudioSpanRegions(regions), []);
});
