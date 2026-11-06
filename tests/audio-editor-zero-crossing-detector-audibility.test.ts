/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { zeroCrossingRenderProject } from '../src/common/editor/controller/track-audio/internal/zero-crossing-render-project.ts';
import { renderZeroCrossingEdges } from '../src/common/editor/controller/track-audio/internal/zero-crossing-edge-windows.ts';
import type { SelectionViewRenderRange } from '../src/common/editor/controller/track-audio/internal/selection-view-service-types.d.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { findNearestAudioZeroCrossing } from '../src/common/editor/zero-crossing.js';
import { zeroCrossingDetectorProject } from './helpers/zero-crossing-detector-project.ts';

for (const mode of ['leaf', 'folder', 'vca'] as const) test(`zero crossing retains ${mode} detector gates while ignoring the selected track mute`, () => {
	const { project } = zeroCrossingDetectorProject('post-fader', mode, true, mode === 'vca'), before = structuredClone(project);
	const capture = zeroCrossingRenderProject(project, 'programme');
	assert.equal(capture.respectMuteSolo, true, 'the renderer must apply the retained control gates');
	const key = capture.project.tracks.find(track => track.id === 'key'); assert.ok(key);
	if (mode !== 'vca') assert.equal(key.mute, true);
	else assert.deepEqual(capture.project.mixer.vcas[0]?.members, [{ kind: 'track', id: 'key' }]);
	const programme = capture.project.mixer.edges.find(edge => edge.source.kind === 'track' && edge.source.id === 'programme'
		&& edge.kind === 'assignment' && edge.destination.kind === 'output');
	assert.equal(programme?.position, 'pre-fader', 'target audibility stays bypassed independently of its detector gates');
	assert.equal(capture.trackId, undefined, 'the retained detector graph must reach the rack');
	assert.deepEqual(project, before);
});

test('an ordinary muted target still ignores mute when no detector closure is retained', () => {
	const { project } = zeroCrossingDetectorProject('post-fader', 'none', true), before = structuredClone(project);
	const capture = zeroCrossingRenderProject(project, 'programme');
	assert.equal(capture.respectMuteSolo, false);
	assert.equal(capture.trackId, 'programme');
	assert.equal(capture.project.tracks.find(track => track.id === 'programme')?.mute, true);
	assert.deepEqual(project, before);
});

for (const position of ['pre-fader', 'post-fader'] as const) test(`the edge renderer carries ${position} detector custody to its actual render request`, async () => {
	const { project } = zeroCrossingDetectorProject(position), before = structuredClone(project);
	const ranges: SelectionViewRenderRange[] = [];
	await renderZeroCrossingEdges({ getProject: () => project, cloneProject: value => structuredClone(value),
		audioBufferChannels, findNearestAudioZeroCrossing,
		renderSnapshot: (_capture, range) => {
			ranges.push(range); return { channels: [new Float32Array(range.outputFrames)] };
		},
	}, project, ['programme'], { startFrame: 10_007, endFrame: 11_007 }, 480,
	{ startFrame: 9_527, endFrame: 11_487 });
	assert.equal(ranges.length, 1, 'wet history remains one continuous capture');
	assert.equal(ranges[0]?.respectMuteSolo, true);
	assert.equal(ranges[0]?.trackId, undefined);
	assert.deepEqual(project, before);
});
