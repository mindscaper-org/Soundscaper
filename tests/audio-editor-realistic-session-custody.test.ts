/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { mixedSessionCustody, MIXED_SESSION_CASES, ENVELOPE, SESSION_FRAMES as D, SOURCE_IN as I } from './helpers/mixed-session-custody.ts';

for (const row of MIXED_SESSION_CASES) test(`mixed ${row.action} preserves independent editorial state and PCM through history, repository reopen and Scape`, async context => {
	const { project, split: s } = await mixedSessionCustody(context, row);
	assert.equal(project.tempo.bpm, row.tempo);
	const voice = project.tracks.find(track => track.id === 'voice'); assert.ok(voice?.type === 'audio');
	assert.deepEqual(voice.effects.map(effect => [effect.type, effect.enabled, effect.params]), [['audacity-invert', true, {}]]);
	assert.equal(voice.mute, row.action === 'mute-solo'); assert.equal(voice.solo, row.action === 'mute-solo');
	assert.equal(project.sources.length, row.action === 'accent-delete-undo' ? 2 : 1);
	assert.equal(project.tracks.length, ['duplicate-clip', 'duplicate-track', 'accent-delete-undo'].includes(row.action) ? 3 : 2);
	const main = resolveRuntimeProjectProjection(project).clips.filter(clip => clip.sourceId === 'recording');
	let windows = [[0, s, I], [s, D - s, I + s]];
	if (row.action === 'duplicate-clip') windows.push([0, s, I]);
	if (row.action === 'duplicate-track') windows = [...windows, ...windows];
	if (row.action === 'insert-paste') windows = [[0, s, I], [s, s, I], [2 * s, D - s, I + s]];
	if (row.action === 'trim-redo') windows = [[0, s - 4800, I], [s, D - s, I + s]];
	if (row.action === 'second-split') { const at = Math.round(s * .52); windows = [[0, at, I], [at, s - at, I + at], [s, D - s, I + s]]; }
	if (row.action === 'ripple-delete') { const a = Math.round(s * .2), b = Math.round(s * .52); windows = [[0, a, I], [a, s - b, I + b], [s - (b - a), D - s, I + s]]; }
	const sort = (rows: number[][]) => rows.sort((a, b) => a[0]! - b[0]! || a[2]! - b[2]!);
	assert.deepEqual(sort(main.map(clip => [clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame])), sort(windows));
	assert.equal(new Set(project.clips.map(clip => clip.id)).size, project.clips.length);
	for (const clip of main) {
		assert.ok(clip.kind === 'audio'); assert.equal(clip.gain, 10 ** (-2 / 20)); assert.equal(clip.stretchToTempo, true);
		assert.equal(clip.sourceDurationFrames, clip.durationFrames);
		assert.equal(clip.fadeInFrames, clip.sourceStartFrame === I ? 4800 : 96);
		assert.equal(clip.fadeOutFrames, clip.sourceStartFrame + clip.sourceDurationFrames === I + D ? 9600 : 96);
		assert.equal(clip.reversed, row.action === 'reverse-invert' && clip.sourceStartFrame === I + s);
		assert.equal(clip.inverted, row.action === 'reverse-invert' && clip.sourceStartFrame === I + s);
		assert.ok(clip.envelope.length >= 2);
		for (const point of clip.envelope) {
			const frame: number = clip.sourceStartFrame - I + point.frame;
			const right: typeof ENVELOPE[number] | undefined = ENVELOPE.find(point => point.frame >= frame); assert.ok(right);
			const left: typeof ENVELOPE[number] | undefined = [...ENVELOPE].reverse().find(point => point.frame <= frame); assert.ok(left);
			const expected: number = left.frame === right.frame ? left.value : left.value + (right.value - left.value) * (frame - left.frame) / (right.frame - left.frame);
			assert.ok(Math.abs(point.value - expected) < 1e-9);
		}
	}
	const lane = project.automationLanes.find(lane => lane.id === 'gain-ride'); assert.ok(lane);
	if (row.action === 'insert-paste') {
		assert.deepEqual(lane.points[0] && [lane.points[0].position, lane.points[0].value], [0, 1]);
		assert.deepEqual(lane.points.find(point => point.id === 'ride-start'), { id: 'ride-start', position: s, value: 1 });
		assert.deepEqual(lane.points.find(point => point.id === 'ride-later'), { id: 'ride-later', position: 48_000 + s, value: .75 + (row.tempo % 3 - 1) / 100 });
	} else assert.deepEqual(lane.points[0], { id: 'ride-start', position: 0, value: 1 });
	if (row.action !== 'ripple-delete' && row.action !== 'insert-paste') {
		assert.deepEqual(lane.points, [{ id: 'ride-start', position: 0, value: 1 }, { id: 'ride-later', position: 48_000, value: .75 + (row.tempo % 3 - 1) / 100 }]);
	}
	if (row.action === 'duplicate-track' || row.action === 'duplicate-clip') {
		const derived = project.tracks.find(track => track.id !== 'voice' && track.id !== 'empty'); assert.ok(derived?.type === 'audio');
		assert.deepEqual(derived.effects.map(({ id: _id, ...effect }) => effect), voice.effects.map(({ id: _id, ...effect }) => effect));
		assert.ok(derived.effects.every(effect => voice.effects.every(original => original.id !== effect.id)));
		assert.equal(project.automationLanes.length, 2);
		const copied: SoundscaperProject['automationLanes'][number] | undefined = project.automationLanes.find(candidate =>
			candidate.address.kind === 'strip' && candidate.address.strip.kind === 'track' && candidate.address.strip.id === derived.id);
		assert.ok(copied); assert.equal(copied.timebase, 'absolute-samples');
		assert.deepEqual(copied.address, { kind: 'strip', strip: { kind: 'track', id: derived.id }, parameterId: 'gain' });
		assert.deepEqual(copied.points.map(point => [point.position, point.value]), [[0, 1], [48_000, .75 + (row.tempo % 3 - 1) / 100]]);
		assert.deepEqual(copied.segments, [{ kind: 'linear' }]);
		assert.ok(copied.points.every(point => lane.points.every(original => point.id !== original.id)));
		assert.notEqual(copied.id, lane.id);
	}
});
