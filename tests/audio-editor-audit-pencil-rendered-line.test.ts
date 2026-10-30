/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { samplePointAtPointer } from '../src/common/editor/ui/timeline/track-row-helpers.jsx';
import { createPencilSampleEdits } from '../src/common/editor/sample-edit.js';
import { createImmutablePcmChunks, editImmutablePcmSamples, readImmutablePcmRange } from '../src/common/editor/pcm-chunks.js';
import { evaluateClipFadeAt } from '../src/common/editor/audio-clip-transition-gain.ts';
import { envelopeValueAtFrame } from '../src/common/editor/automation.js';
import { evaluateAudioWarpMapAtSource } from '../src/common/editor/audio-warp-domain.ts';

test('a horizontal pointer stroke stays horizontal through authored gain, fades, envelopes, and polarity', () => {
	for (const inverted of [false, true]) for (const reversed of [false, true]) {
		const current = createSoundscaperProject({ id: 'pencil-fade',
			sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 8 }],
			clips: [{ id: 'clip', sourceId: 'source', sourceStartFrame: 0, sourceDurationFrames: 8,
				timelineStartFrame: 0, durationFrames: 8, fadeInFrames: 4, fadeInShape: 2, gain: 2, inverted, reversed,
				envelope: [{ frame: 0, value: 1 }, { frame: 7, value: 0.5 }] }],
			tracks: [{ id: 'track', clipIds: ['clip'] }],
		});
		const project = projectForRuntimeConsumers(current);
		const clip = project.clips[0]!;
		const source = project.sources[0]!;
		assert.ok(source.kind === 'audio');
		const lane = { dataset: { waveformRulerFormat: 'linear-amp' }, getBoundingClientRect: () => ({ top: 0, height: 100 }) };
		const points = [1, 3].map(frame => samplePointAtPointer({ clientX: frame * 4, clientY: 45 }, lane, clip, source, (x: number) => x / 4));
		const edits = createPencilSampleEdits({ clip, source, project, points, channel: 0 });
		const original = [new Float32Array(8)];
		const edited = readImmutablePcmRange(editImmutablePcmSamples(createImmutablePcmChunks(original), edits).pcm);
		for (const frame of [1, 2, 3]) {
			const gain = (inverted ? -1 : 1) * Number(clip.gain)
				* evaluateClipFadeAt(frame, clip.durationFrames, Number(clip.fadeInFrames), 'in', Number(clip.fadeInShape))
				* envelopeValueAtFrame(clip.envelope, frame, clip.durationFrames);
			const rendered = edited[0]![reversed ? 7 - frame : frame]! * gain;
			assert.ok(Math.abs(rendered - 0.1) < 1e-7, `frame ${frame}: rendered ${rendered}`);
		}
		assert.equal(original[0]!.every(sample => sample === 0), true);
	}
});

test('warped and repeating Pencil strokes undo gain at the interpolated timeline position', () => {
	for (const warped of [false, true]) {
		const current = createSoundscaperProject({ id: 'pencil-mapped',
			sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 96 }],
			clips: [{ id: 'clip', sourceId: 'source', sourceStartFrame: 0, sourceDurationFrames: warped ? 96 : 48,
				timelineStartFrame: 0, durationFrames: 96, fadeInFrames: 96, fadeInShape: 2, gain: 2,
				...(warped ? { warpMap: { feature: 'audio-warp', points: [
					{ outer: 0, source: 0, mode: 'forward' }, { outer: 32, source: 64, mode: 'forward' },
					{ outer: 96, source: 96, mode: 'forward' },
				] } } : { opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 48, offsetFrames: 0 } } }),
			}], tracks: [{ id: 'track', clipIds: ['clip'] }],
		});
		const project = projectForRuntimeConsumers(current);
		const clip = project.clips[0]!;
		const source = project.sources[0]!;
		assert.ok(source.kind === 'audio');
		const lane = { dataset: { waveformRulerFormat: 'linear-amp' }, getBoundingClientRect: () => ({ top: 0, height: 100 }) };
		const points = (warped ? [16, 48] : [47, 49]).map(frame => samplePointAtPointer(
			{ clientX: frame * 4, clientY: 49 }, lane, clip, source, (x: number) => x / 4));
		const edits = createPencilSampleEdits({ clip, source, project, points });
		assert.ok(edits.length > 2);
		for (const edit of edits) {
			const outer = warped ? evaluateAudioWarpMapAtSource(clip.warpMap, edit.frame) : null;
			const timelineFrame = outer ? outer.num / outer.den : edit.frame === 47 ? 47 : 48 + edit.frame;
			const gain = 2 * evaluateClipFadeAt(timelineFrame, 96, 96, 'in', 2);
			assert.ok(Math.abs(edit.value * gain - 0.02) < 1e-9, `mapped frame ${edit.frame}`);
		}
	}
});
