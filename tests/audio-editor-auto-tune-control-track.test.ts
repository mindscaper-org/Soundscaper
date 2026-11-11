/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { normalizeAutoTuneParams } from '../src/common/editor/first-party-effects/auto-tune/definition.ts';
import { autoTuneControlNotes } from '../src/common/editor/first-party-effects/auto-tune/project-control.ts';
import { autoTuneCorrection, createAutoTuneControlLookup } from '../src/common/editor/first-party-effects/auto-tune/control-notes.ts';
import { applyAutoTune } from '../src/common/editor/first-party-effects/auto-tune/selection.ts';
import { createAutoTuneProcessor } from '../src/common/editor/first-party-effects/auto-tune/dsp.ts';
import { loadStaffPadWasm } from '../src/common/editor/staffpad/runtime.js';
import { registerAutoTuneControl, scheduleAutoTuneControls, setOfflineAutoTuneControlWindows, initialAutoTuneControlSchedules } from '../src/common/editor/engine/auto-tune-control.ts';
import { ScheduledParameterRegistry } from '../src/common/editor/engine/scheduled-parameter-registry.ts';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { normalizeSelectionEffectWorkerContext } from '../src/common/editor/selection-effects-worker-context.ts';
import { createEffect, normalizeEffect } from '../src/common/editor/effects.js';

const rate = 48000;
const runtime = async () => loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
function fixture(changes: Record<string, unknown> = {}) {
	const clip = createMidiClip({ id: 'notes', sourceId: 'source', title: 'Melody', timelineStartFrame: 1000,
		sourceStartFrame: 100, sourceDurationFrames: 200, durationFrames: 400,
		notes: [{ id: 'a', pitch: 69, startFrame: 50, durationFrames: 100, velocity: 100, channel: 0 },
			{ id: 'b', pitch: 72, startFrame: 200, durationFrames: 100, velocity: 100, channel: 0 }], ...changes });
	return { sampleRate: rate, tracks: [{ ...createMidiTrack({ id: 'midi', name: 'Melody', clipIds: ['notes'] }) }], clips: [{ ...clip }] };
}

test('control track is optional, validated and preserves its stable ID', () => {
	assert.equal(normalizeAutoTuneParams().controlTrackId, '');
	assert.equal(normalizeAutoTuneParams({ controlTrackId: 'midi' }).controlTrackId, 'midi');
	const restored = normalizeEffect(JSON.parse(JSON.stringify(createEffect('auto-tune', { params: { controlTrackId: 'midi' } }))));
	assert.equal((restored.params as Readonly<Record<string, unknown>>).controlTrackId, 'midi');
	for (const value of [42, {}, ' '.repeat(2), 'a'.repeat(513)]) assert.throws(() => normalizeAutoTuneParams({ controlTrackId: value }), /controlTrackId/);
});

test('control clips follow loops, project tempo and render sample rate without mutating the MIDI', () => {
	const project = fixture();
	project.clips[0] = { ...project.clips[0]!, ...clipLoopUpdateFields({ ...project.clips[0]!, durationFrames: 400 }, { periodFrames: 400, durationFrames: 800 }) };
	assert.deepEqual(autoTuneControlNotes(project, 'midi', 1000, 400, 24000), [
		{ startFrame: 0, endFrame: 50, pitch: 69 }, { startFrame: 100, endFrame: 200, pitch: 72 },
		{ startFrame: 200, endFrame: 250, pitch: 69 }, { startFrame: 300, endFrame: 400, pitch: 72 },
	]);
	const musical = fixture({ anchor: 'musical', musicalStartBeat: { num: 2, den: 1 } });
	const mapped = { ...musical, tempoMap: { mode: 'musical' as const, events: [{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } }] } };
	const before = structuredClone(mapped);
	assert.equal(autoTuneControlNotes(mapped, 'midi', 0, rate * 3, rate)[0]?.startFrame, rate * 2);
	assert.deepEqual(mapped, before);
});

test('graph schedules align MIDI to seek, transport speed, context rate and upstream rack delay', () => {
	const registry = new ScheduledParameterRegistry(), packets: unknown[] = [];
	registerAutoTuneControl(registry, { postMessage: (packet: unknown) => { packets.push(packet); } }, 'midi', 256);
	const options = { fromFrame: 1000, toFrame: 1400, contextStartTime: 2, sampleRate: rate, contextSampleRate: 96000, transportRate: 2 };
	scheduleAutoTuneControls(fixture(), new ScheduledParameterRegistry(), options);
	assert.equal(packets.length, 0, 'sibling graphs do not receive control messages');
	scheduleAutoTuneControls(fixture(), registry, options);
	assert.deepEqual(packets, [{ type: 'control-notes', fromFrame: 192256, toFrame: 192656, notes: [
		{ startFrame: 192256, endFrame: 192356, pitch: 69 }, { startFrame: 192456, endFrame: 192656, pitch: 72 },
	] }]);
});

test('offline nodes receive MIDI control before processing concatenated render windows', () => {
	const context = { sampleRate: rate };
	setOfflineAutoTuneControlWindows(context, fixture(), [{ startFrame: 1000, endFrame: 1200 },
		{ startFrame: 1200, endFrame: 1400 }], rate);
	assert.deepEqual(initialAutoTuneControlSchedules(context, 'midi', 64), [
		{ type: 'control-notes', fromFrame: 64, toFrame: 264, notes: [{ startFrame: 64, endFrame: 164, pitch: 69 }] },
		{ type: 'control-notes', fromFrame: 264, toFrame: 464, notes: [{ startFrame: 264, endFrame: 464, pitch: 72 }] },
	]);
	assert.deepEqual(initialAutoTuneControlSchedules({ sampleRate: rate }, 'midi', 64), []);
	assert.deepEqual(initialAutoTuneControlSchedules(context, '', 64), []);
});

test('worker context retains validated MIDI notes and extreme intervals stay in the audited native range', () => {
	const controlNotes = [{ startFrame: 0, endFrame: rate, pitch: 71 }];
	assert.deepEqual(normalizeSelectionEffectWorkerContext({ controlNotes }).controlNotes, controlNotes);
	assert.throws(() => normalizeSelectionEffectWorkerContext({ controlNotes: [{ ...controlNotes[0], pitch: NaN }] }), /control note/);
	assert.equal(autoTuneCorrection(69, 127, 100), 12);
	assert.equal(autoTuneCorrection(69, 0, 100), -12);
	assert.equal(autoTuneCorrection(69, 71, 50), 1);
});

test('control notes share trimmed, stretched, moved and reversed MIDI clip timing', () => {
	assert.deepEqual(autoTuneControlNotes(fixture(), 'midi', 900, 1000, rate), [
		{ startFrame: 100, endFrame: 200, pitch: 69 }, { startFrame: 300, endFrame: 500, pitch: 72 },
	]);
	assert.deepEqual(autoTuneControlNotes(fixture({ reversed: true }), 'midi', 0, 2000, rate), [
		{ startFrame: 1000, endFrame: 1200, pitch: 72 }, { startFrame: 1300, endFrame: 1400, pitch: 69 },
	]);
	assert.deepEqual(autoTuneControlNotes(fixture(), '', 0, 2000, rate), []);
	assert.throws(() => autoTuneControlNotes(fixture(), 'gone', 0, 2000, rate), /MIDI control track/);
	assert.throws(() => autoTuneControlNotes({ ...fixture(), tracks: [{ id: 'audio', type: 'audio', clipIds: [] }] }, 'audio', 0, 2000, rate), /MIDI control track/);
});

test('MIDI control chooses the nearest active absolute pitch, with deterministic chords and uncorrected rests', () => {
	const lookup = createAutoTuneControlLookup([
		{ startFrame: 100, endFrame: 200, pitch: 72 }, { startFrame: 100, endFrame: 300, pitch: 69 },
	]);
	assert.equal(lookup(99, 70), null);
	assert.equal(lookup(100, 70.5), 69);
	assert.equal(lookup(150, 71.5), 72);
	assert.equal(lookup(200, 72), 69);
	assert.equal(lookup(300, 72), null);
	assert.equal(lookup(100, 81), 72, 'MIDI octave is authoritative');
	assert.throws(() => createAutoTuneControlLookup([{ startFrame: 5, endFrame: 4, pitch: 69 }]), /control note/);
});

test('selection rendering follows MIDI melody rather than the scale and leaves an empty control track dry', async () => {
	const staffPadRuntime = await runtime();
	const input = Float32Array.from({ length: rate * 2 }, (_, frame) => .3 * Math.sin(2 * Math.PI * 450 * frame / rate));
	const params = { controlTrackId: 'midi', retune: 0 };
	const [output] = await applyAutoTune([input], rate, params, { staffPadRuntime, controlNotes: [
		{ startFrame: 0, endFrame: rate, pitch: 71 }, { startFrame: rate, endFrame: rate * 2, pitch: 69 },
	] });
	assert.ok(Math.abs(pitch(output!, .3, .7) - 493.883) < 1);
	assert.ok(Math.abs(pitch(output!, 1.3, 1.7) - 440) < 1);
	assert.deepEqual(await applyAutoTune([input], rate, params, { controlNotes: [] }), [input]);
	await assert.rejects(applyAutoTune([input], rate, params), /MIDI control notes/);
});

test('realtime MIDI control uses the delayed analysis clock and follows consecutive schedule windows', async () => {
	const processor = createAutoTuneProcessor({ sampleRate: rate, channelCount: 1, params: { controlTrackId: 'midi', retune: 0 }, staffPadRuntime: await runtime() });
	try {
		processor.scheduleControlNotes([{ startFrame: 0, endFrame: rate, pitch: 71 }], 0, rate);
		processor.scheduleControlNotes([{ startFrame: rate, endFrame: rate * 2, pitch: 69 }], rate, rate * 2);
		const frames = rate * 2 + processor.latencyFrames;
		const output = new Float32Array(frames);
		for (let start = 0; start < frames; start += 128) {
			const count = Math.min(128, frames - start);
			const input = Float32Array.from({ length: count }, (_, frame) => .3 * Math.sin(2 * Math.PI * 450 * (start + frame) / rate));
			processor.processBlock([input], [output.subarray(start, start + count)], count, start);
		}
		const aligned = output.subarray(processor.latencyFrames);
		assert.ok(Math.abs(pitch(aligned, .3, .7) - 493.883) < 1);
		assert.ok(Math.abs(pitch(aligned, 1.3, 1.7) - 440) < 1);
	} finally { processor.dispose(); }
});

test('extreme MIDI targets remain finite and bounded in the realtime native engine', async () => {
	for (const note of [0, 127]) {
		const processor = createAutoTuneProcessor({ sampleRate: rate, channelCount: 1, params: { controlTrackId: 'midi', retune: 0 }, staffPadRuntime: await runtime() });
		try {
			processor.scheduleControlNotes([{ startFrame: 0, endFrame: rate, pitch: note }], 0, rate);
			const output = new Float32Array(128);
			for (let start = 0; start < rate; start += 128) {
				const input = Float32Array.from({ length: 128 }, (_, frame) => .3 * Math.sin(2 * Math.PI * 450 * (start + frame) / rate));
				processor.processBlock([input], [output], 128);
				assert.ok(output.every(Number.isFinite));
			}
		} finally { processor.dispose(); }
	}
});

function pitch(samples: Float32Array, start: number, end: number): number {
	const crossings: number[] = [];
	for (let frame = rate * start + 1; frame < rate * end; frame++) {
		const left = samples[frame - 1]!, right = samples[frame]!;
		if (left <= 0 && right > 0) crossings.push(frame - 1 - left / (right - left));
	}
	return (crossings.length - 1) * rate / (crossings.at(-1)! - crossings[0]!);
}
