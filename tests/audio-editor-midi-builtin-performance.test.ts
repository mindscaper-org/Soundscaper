/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';
import { createMidiExpressionIndex } from '../src/common/editor/engine/midi-expression.ts';
import { createMidiPlaneRenderer, renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { publishMidiRecipe } from '../src/common/editor/storage/midi-source.ts';
import { createMidiRenderWorker } from '../src/common/editor/engine/midi-render-worker.ts';
import type { MidiFileEvent } from '../src/common/editor/midi-file-types.ts';
import type { MidiClipData, MidiNote } from '../src/common/editor/midi-model.ts';
const note = (pitch = 69, startFrame = 0, durationFrames = 4800, channel = 0): MidiNote => ({ id: `${pitch}-${startFrame}-${channel}`, pitch, startFrame, durationFrames, velocity: 100, channel });
const cc = (frame: number, controller: number, value: number, channel = 0): MidiFileEvent => ({ frame, status: 0xb0 | channel, data: [controller, value] });
const data = (notes: readonly MidiNote[], events: readonly MidiFileEvent[]): MidiClipData => ({ version: 1, notes, interchange: { events, tempos: [], signatures: [] } });
const audible = (plane: Float32Array): boolean => plane.some(value => Math.abs(value) > .001);

test('sostenuto captures held keys, releases on pedal up, and excludes subsequent keys', () => {
	const events = [cc(1000, 66, 127), cc(6000, 66, 0)];
	assert.ok(audible(renderMidiFrames([note(69, 0, 2400)], 'triangle', 48000, 4000, 512, events)));
	assert.ok(!audible(renderMidiFrames([note(69, 2000, 1000)], 'triangle', 48000, 4000, 512, events)));
	assert.ok(!audible(renderMidiFrames([note(69, 0, 2400)], 'triangle', 48000, 6000, 512, events)));
});

test('sostenuto and sustain release independently, and reset controllers releases both', () => {
	const events = [cc(100, 66, 127), cc(200, 64, 127), cc(4000, 66, 0), cc(6000, 64, 0)];
	assert.ok(audible(renderMidiFrames([note(69, 0, 2400)], 'triangle', 48000, 4500, 512, events)));
	assert.ok(!audible(renderMidiFrames([note(69, 0, 2400)], 'triangle', 48000, 6000, 512, events)));
	assert.ok(!audible(renderMidiFrames([note(69, 0, 2400)], 'triangle', 48000, 3500, 512, [...events, cc(3000, 121, 0)])));
});

test('pitch bend sensitivity follows RPN selection, updates a held bend, and preserves channel isolation', () => {
	const events = [cc(0, 101, 0), cc(0, 100, 0), cc(0, 6, 12), { frame: 0, status: 0xe0, data: [127, 127] }, cc(1000, 38, 50), cc(2000, 99, 1), cc(2000, 6, 1)] satisfies MidiFileEvent[];
	const index = createMidiExpressionIndex(events);
	const states = index.forNote(note()).states;
	assert.equal([...states].reverse().find(state => state.frame === 0)!.bendRatio, 2 ** ((8191 / 8192 * 12) / 12));
	assert.equal(states.at(-1)!.bendRatio, 2 ** ((8191 / 8192 * 12.5) / 12));
	assert.equal(index.forNote(note(69, 0, 4800, 1)).states.at(-1)!.bendRatio, 1);
});

test('mono mode sounds the latest key alone while poly mode restores overlapping voices', () => {
	const notes = [note(60, 1000, 8000), note(69, 2000, 5000)];
	const mono = [cc(0, 126, 1)];
	assert.deepEqual(renderMidiFrames(notes, 'triangle', 48000, 3000, 512, mono), renderMidiFrames([notes[1]!], 'triangle', 48000, 3000, 512, mono));
	const poly = [...mono, cc(9500, 127, 0)];
	const later = [note(60, 10000, 8000), note(69, 11000, 5000)];
	assert.deepEqual(renderMidiFrames(later, 'triangle', 48000, 12000, 512, poly), renderMidiFrames(later, 'triangle', 48000, 12000, 512));
});

for (const pan of [0, 127]) test(`built-in pan ${pan} renders the correct stereo plane and supports independent windows`, async () => {
	const source = data([note(69, 0, 10000)], [cc(0, 10, pan)]);
	const renderer = await openMidiAudioRenderer(source, 'triangle', 48000);
	try {
		assert.equal(renderer.channelCount, 2);
		const planes = await renderer.render(0, 6000);
		assert.ok(audible(planes[pan === 0 ? 0 : 1]!));
		assert.ok(!audible(planes[pan === 0 ? 1 : 0]!));
		assert.deepEqual(await renderer.render(2000, 512), planes.map(plane => plane.slice(2000, 2512)));
	} finally { await renderer.close(); }
});

test('new panned recipes publish stereo while existing mono geometry stays readable in workers', async () => {
	const source = data([note()], [cc(0, 10, 0)]);
	const record = await publishMidiRecipe({ putMetadataIfAbsent: async () => true }, 'source', { data: source, instrument: 'triangle', sampleRate: 48000 }, { frameCount: 4800 });
	assert.equal(record.channelCount, 2);
	const worker = createMidiRenderWorker();
	const ready = await worker({ id: 'open', data: source, instrument: 'triangle', sampleRate: 48000, channelCount: 1 });
	assert.equal(ready.channelCount, 1);
	const rendered = await worker({ id: 'pcm', start: 1000, frames: 512 });
	assert.equal(rendered.channels!.length, 1);
	assert.ok(audible(rendered.channels![0]!));
});

test('pitch sensitivity reset preserves its assignment, null/NRPN selection blocks data entry, and inc/dec use semitones', () => {
	const events = [cc(0, 101, 0), cc(0, 100, 0), cc(0, 6, 12), cc(0, 96, 0), cc(0, 97, 0), cc(0, 121, 0),
		cc(0, 6, 1), { frame: 0, status: 0xe0, data: [0, 96] }, cc(100, 99, 0), cc(100, 6, 3), cc(200, 100, 0), cc(200, 6, 4)] satisfies MidiFileEvent[];
	const states = createMidiExpressionIndex(events).forNote(note()).states;
	assert.equal([...states].reverse().find(state => state.frame === 0)!.bendRatio, Math.sqrt(2));
	assert.equal(states.at(-1)!.bendRatio, Math.sqrt(2), 'CC121 nulls the prior RPN selection');
	const selected = [...events, cc(300, 101, 0), cc(300, 6, 4)];
	assert.equal(createMidiExpressionIndex(selected).forNote(note()).states.at(-1)!.bendRatio, 2 ** (2 / 12));
});

test('mono voices remain independent across ports/channels and resume a held earlier key', () => {
	const notes = [note(60, 1000, 8000), note(69, 2000, 3000)];
	const events = [cc(0, 126, 1)];
	assert.deepEqual(renderMidiFrames(notes, 'triangle', 48000, 6000, 512, events), renderMidiFrames([notes[0]!], 'triangle', 48000, 6000, 512, events));
	const otherChannel = notes.map(value => ({ ...value, channel: 1 }));
	const otherPort = notes.map(value => ({ ...value, midiPort: 1 }));
	for (const isolated of [otherChannel, otherPort]) assert.deepEqual(renderMidiFrames(isolated, 'triangle', 48000, 3000, 512, events), renderMidiFrames(isolated, 'triangle', 48000, 3000, 512));
	const full = renderMidiFrames(notes, 'triangle', 48000, 0, 10000, events);
	for (const start of [0, 500, 1999, 2300, 4999, 5500, 8999]) assert.deepEqual(renderMidiFrames(notes, 'triangle', 48000, start, 512, events), full.slice(start, start + 512));
});

test('mid-note pan changes and reset controllers retain port-local pan and absolute window PCM', async () => {
	const events = [cc(0, 10, 0), cc(3000, 10, 127), cc(4000, 121, 0)];
	const renderer = await openMidiAudioRenderer(data([note(69, 0, 10000)], events), 'sine', 48000);
	try {
		const full = await renderer.render(0, 8000);
		assert.ok(audible(full[0]!.slice(500, 2000)));
		assert.ok(!audible(full[1]!.slice(500, 2000)));
		assert.ok(!audible(full[0]!.slice(4500, 6000)));
		assert.ok(audible(full[1]!.slice(4500, 6000)));
		assert.deepEqual(await renderer.render(2999, 2400), full.map(plane => plane.slice(2999, 5399)));
	} finally { await renderer.close(); }
	const isolated = await openMidiAudioRenderer(data([{ ...note(), midiPort: 1 }], [cc(0, 10, 0)]), 'sine', 48000);
	try {
		const planes = await isolated.render(1000, 512);
		assert.deepEqual(planes[0], planes[1]);
		assert.ok(audible(planes[0]!));
	} finally { await isolated.close(); }
});

test('stereo synthesis shares pan calculations across voices, controller spans and windows', t => {
	const cosine = t.mock.method(Math, 'cos');
	const notes = Array.from({ length: 24 }, (_, index) => note(36 + index, index * 3, 8000));
	const events = [cc(0, 10, 36), cc(500, 11, 83), cc(900, 10, 83), cc(1700, 10, 36)];
	const render = createMidiPlaneRenderer(notes, 'triangle', 48000, events, 2);
	const whole = render(0, 2400);
	for (const [start, frames] of [[1700, 700], [300, 1024], [1300, 1024]] as const) {
		assert.deepEqual(render(start, frames), whole.map(plane => plane.slice(start, start + frames)));
	}
	assert.ok(audible(whole[0]!) && audible(whole[1]!));
	assert.equal(cosine.mock.callCount(), 2, 'only the two distinct pan values require trigonometry');
});
