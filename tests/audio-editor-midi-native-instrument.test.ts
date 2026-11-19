/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMidiTrackData, readMidiTrack, withMidiTrackData } from '../src/common/editor/midi-model.ts';
import { openMidiAudioRenderer, registerMidiInstrumentProvider } from '../src/common/editor/engine/midi-audio-renderer.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

const instrument = { kind: 'native' as const, format: 'vst3' as const, stablePluginId: 'synth', binarySha256: 'a'.repeat(64), name: 'Synth', state: '' };

test('native instrument identity and state survive track normalization', () => {
	assert.deepEqual(normalizeMidiTrackData({ version: 1, instrument }).instrument, instrument);
	assert.throws(() => normalizeMidiTrackData({ version: 1, instrument: { ...instrument, binarySha256: 'bad' } }));
	assert.throws(() => normalizeMidiTrackData({ version: 1, instrument: { ...instrument, format: 'ladspa' } }));
	const track = withMidiTrackData({ type: 'audio', opaqueExtensions: {} }, { version: 1, instrument });
	const carrier = (track.opaqueExtensions as Record<string, { instrument: string; nativeInstrument: unknown }>)['soundscaper.midi']!;
	assert.equal(carrier.instrument, 'triangle');
	assert.deepEqual(carrier.nativeInstrument, instrument);
	assert.deepEqual(readMidiTrack(JSON.parse(JSON.stringify(track)))?.instrument, instrument);
});

test('native MIDI rendering sends block-relative channel messages and retains stereo PCM', async () => {
	const messages: unknown[] = [];
	let closed = 0;
	const unregister = registerMidiInstrumentProvider(async () => ({ channelCount: 2, latencyFrames: 0,
		process: async (frames, events) => { messages.push(events); return [new Float32Array(frames).fill(0.25), new Float32Array(frames).fill(-0.5)]; },
		close: async () => { closed++; },
	}));
	try {
		const render = await openMidiAudioRenderer({ version: 1, notes: [{ id: 'n', startFrame: 2, durationFrames: 3, pitch: 60, velocity: 99, releaseVelocity: 42, channel: 4 }],
			interchange: { events: [{ frame: 0, status: 0xc4, data: [12] }], tempos: [], signatures: [] } }, instrument, 8000);
		assert.equal(render.channelCount, 2);
		assert.deepEqual((await render.render(0, 4)).map(plane => [...plane]), [[0.25, 0.25, 0.25, 0.25], [-0.5, -0.5, -0.5, -0.5]]);
		await render.render(4, 4);
		assert.deepEqual(messages, [[{ frame: 0, data: [0xc4, 12] }, { frame: 2, data: [0x94, 60, 99] }], [{ frame: 1, data: [0x84, 60, 42] }]]);
		await render.close();
		assert.equal(closed, 1);
	} finally { unregister(); }
});

test('instrument assignment and note edits atomically publish native audio', async () => {
	const fixture = midiServiceFixture();
	const { trackId, clipId } = await fixture.service.addTrack();
	const unregister = registerMidiInstrumentProvider(async () => ({ channelCount: 1, latencyFrames: 0,
		process: async frames => [new Float32Array(frames).fill(0.625)], close: async () => undefined,
	}));
	try {
		await fixture.service.setInstrument(trackId, instrument);
		await fixture.service.addNote(clipId, { id: 'n', startFrame: 0, durationFrames: 100, pitch: 60, velocity: 100, channel: 0 });
		const clip = fixture.project().clips.find(clip => clip.id === clipId)!;
		assert.equal(fixture.pcm.get(clip.sourceId!)![0]![20], 0.625);
	} finally { unregister(); }
	const before = fixture.project();
	await assert.rejects(fixture.service.updateNote(clipId, 'n', { pitch: 61 }), /native instrument/i);
	assert.equal(fixture.project(), before);
});

test('reported native latency is removed once across successive source windows', async () => {
	let position = 0;
	const unregister = registerMidiInstrumentProvider(async () => ({ channelCount: 1, latencyFrames: 3,
		process: async frames => { const output = Float32Array.from({ length: frames }, (_, index) => position + index - 3); position += frames; return [output]; },
		close: async () => undefined,
	}));
	try {
		const renderer = await openMidiAudioRenderer({ version: 1, notes: [] }, instrument, 8000);
		assert.deepEqual([...(await renderer.render(0, 4))[0]!], [0, 1, 2, 3]);
		assert.deepEqual([...(await renderer.render(4, 3))[0]!], [4, 5, 6]);
		await renderer.close();
	} finally { unregister(); }
});

test('same-frame key release retains its causal controller order at the native instrument', async () => {
	let messages: unknown;
	const unregister = registerMidiInstrumentProvider(async () => ({ channelCount: 1, latencyFrames: 0,
		process: async (frames, events) => { messages = events; return [new Float32Array(frames)]; }, close: async () => undefined,
	}));
	try {
		const renderer = await openMidiAudioRenderer({ version: 1, notes: [{ id: 'n', startFrame: 0, durationFrames: 1, pitch: 60, velocity: 99, channel: 4,
			onsetStop: { kind: 'all-notes-off', frame: 0, channel: 4, releaseId: 'release', soundEndFrame: null } }],
			interchange: { events: [{ frame: 0, status: 0xb4, data: [64, 127] }, { frame: 0, status: 0xb4, data: [123, 0], releaseId: 'release' }], tempos: [], signatures: [] } }, instrument, 8000);
		await renderer.render(0, 4);
		assert.deepEqual(messages, [{ frame: 0, data: [0xb4, 64, 127] }, { frame: 0, data: [0x94, 60, 99] },
			{ frame: 0, data: [0xb4, 123, 0] }, { frame: 0, data: [0x84, 60, 0] }]);
		await renderer.close();
	} finally { unregister(); }
});
