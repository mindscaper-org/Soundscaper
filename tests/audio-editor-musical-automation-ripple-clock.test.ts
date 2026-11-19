/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAutomationLaneV21, evaluateAutomationLaneAtFrameV21, resolveAutomationLanePointFramesV21 } from '../src/common/editor/automation-lane-v21.ts';
import { replaceAutomationLaneTimelineIntervalV21 } from '../src/common/editor/automation-lane-interval-edit-v21.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { prepareRangeDeleteCommand } from '../src/common/editor/commands/range-runtime.js';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import type { InterpolationShape } from '../src/common/editor/interpolation-curve.ts';

const clock = { sampleRate: 48000, tempoMap: { mode: 'musical' as const, events: [
	{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
	{ beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
	{ beat: { num: 8, den: 1 }, bpm: { num: 180, den: 1 } },
] } };
const address = { kind: 'strip' as const, strip: { kind: 'track' as const, id: 'voice' }, parameterId: 'gain' };

for (const kind of ['linear', 'hold', 'eased', 'bezier'] as const) for (const insertion of [false, true]) {
	test(`musical ${kind} automation retains its sample clock through ${insertion ? 'insert' : 'delete'} across later tempo changes`, () => {
		const shape: InterpolationShape = kind === 'bezier' ? { kind, control1: { position: { num: 4, den: 1 }, value: .15 },
			control2: { position: { num: 8, den: 1 }, value: .8 } } : { kind };
		const lane = normalizeAutomationLaneV21({ id: 'lane', address, timebase: 'musical-beats',
			points: [{ id: 'a', position: { num: 0, den: 1 }, value: 0 }, { id: 'b', position: { num: 12, den: 1 }, value: 1 }], segments: [shape] });
		const startFrame = 24000, endFrame = insertion ? startFrame : 48000, insertedDurationFrames = insertion ? 24000 : 0;
		const delta = insertedDurationFrames - (endFrame - startFrame);
		const edited = replaceAutomationLaneTimelineIntervalV21(lane, { startFrame, endFrame, insertedDurationFrames }, clock);
		for (const frame of [48000, 72000, 95999, 96000, 96001, 120000, 216000, 287999, 288000, 288001, 330000]) {
			const expected = evaluateAutomationLaneAtFrameV21(lane, frame, clock);
			const actual = evaluateAutomationLaneAtFrameV21(edited, frame + delta, clock);
			assert.ok(Math.abs(actual - expected) <= 1e-12, `source frame${frame}: expected${expected}, received${actual}`);
		}
	});
}

test('track ripple keeps a musical gain jump aligned with the audio it moves', () => {
	const project = createSoundscaperProject({ ...clock,
		sources: [{ id: 'source', frameCount: 48000, sampleRate: 48000, channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 192000, durationFrames: 48000 }],
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'] }],
		automationLanes: [{ id: 'ride', address, timebase: 'musical-beats',
			points: [{ id: 'start', position: { num: 0, den: 1 }, value: 0 }, { id: 'jump', position: { num: 6, den: 1 }, value: 1 }], segments: [{ kind: 'hold' }] }],
	});
	const command = prepareRangeDeleteCommand(resolveRuntimeProjectProjection(project), { startFrame: 24000, endFrame: 48000,
		trackIds: ['voice'], rippleMode: 'track' });
	const after = applySoundscaperProjectCommand(project, command);
	assert.equal(resolveRuntimeProjectProjection(after).clips[0]!.timelineStartFrame, 168000);
	assert.equal(resolveAutomationLanePointFramesV21(after.automationLanes[0]!, after).find(point => point.id === 'jump')!.frame, 168000);
});
