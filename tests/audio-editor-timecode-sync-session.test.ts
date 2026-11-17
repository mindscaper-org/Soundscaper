/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTimecodeSyncSession } from '../src/common/editor/controller/transport/timecode-sync-session.ts';
import { DEFAULT_TIMECODE_SYNC_SETTINGS, type TimecodeSyncIo, type TimecodeIoSession } from '../src/common/editor/controller/transport/internal/timecode-sync-ports.ts';
import type { TimecodeReading } from '../src/common/editor/timecode-sync-format.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

function fixture() {
	let now = 1000, position = 480000, playing = false, closed = 0, paused = 0, projectId = 'project', blocked = false, receiveBlocked = false;
	let receive!: (reading: TimecodeReading, timestamp: number) => void;
	const midi: { bytes: number[]; timestamp: number }[] = [];
	const seeks: number[] = [];
	const io: TimecodeSyncIo = {
		devices: async () => ({ midiInputs: [], midiOutputs: [], audioInputs: [], audioOutputs: [] }),
		open: async (_settings, handler) => {
			receive = handler;
			return { sendMidi: (bytes, timestamp) => { midi.push({ bytes, timestamp }); }, clearMidi: () => {}, updateLtc: () => {}, close: async () => { closed++; } };
		},
	};
	const session = createTimecodeSyncSession({ io, now: () => now, schedule: () => () => {},
		read: () => ({ projectId, sampleRate: 48000, positionFrame: position, playing, speed: 1, blocked, receiveBlocked }),
		seek: frame => { position = frame; seeks.push(frame); },
		play: async () => { playing = true; }, pause: async () => { playing = false; paused++; },
	});
	return { session, io, midi, seeks, receive: (reading: TimecodeReading) => receive(reading, now),
		advance: (ms: number) => { if (playing) position += ms * 48; now += ms; session.tick(); },
		playing: () => playing, closed: () => closed, paused: () => paused,
		setPlaying: (value: boolean) => { playing = value; },
		setProject: (value: string) => { projectId = value; },
		setPosition: (value: number) => { position = value; },
		setBlocked: (value: boolean) => { blocked = value; },
		setReceiveBlocked: (value: boolean) => { receiveBlocked = value; },
	};
}

test('sync is inactive by default; MTC sends locate while stopped and ordered timestamped quarter frames while playing', async () => {
	const f = fixture();
	assert.equal(f.session.getSnapshot().active, false);
	await f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, sendMtc: true, midiOutput: 'out', offsetSeconds: 3600 });
	assert.deepEqual(f.midi[0].bytes, [0xf0, 0x7f, 0x7f, 1, 1, 0x21, 0, 10, 0, 0xf7]);
	f.setPlaying(true); f.advance(0); f.advance(40); f.advance(40);
	const quarters = f.midi.filter(message => message.bytes[0] === 0xf1);
	assert.deepEqual(quarters.slice(0, 8).map(message => message.bytes[1] >> 4), [0, 1, 2, 3, 4, 5, 6, 7]);
	assert.equal(quarters[1].timestamp - quarters[0].timestamp, 10);
	await f.session.dispose();
	assert.equal(f.closed(), 1);
});

test('LTC receive chases forward positions, tolerates one frame of drift, and locates reverse without playing', async () => {
	const f = fixture();
	await f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, receive: 'ltc' });
	f.receive({ frame: 250, rate: '25', direction: 1 });
	await f.session.settled(); assert.equal(f.playing(), true);
	const seeks = f.seeks.length;
	f.receive({ frame: 251, rate: '25', direction: 1 });
	await f.session.settled(); assert.equal(f.seeks.length, seeks);
	f.receive({ frame: 260, rate: '25', direction: 1 });
	await f.session.settled(); assert.equal(f.seeks.at(-1), 499200);
	f.receive({ frame: 259, rate: '25', direction: -1 });
	await f.session.settled(); assert.equal(f.playing(), false); assert.equal(f.seeks.at(-1), 497280);
	await f.session.dispose();
});

test('negative received positions stay at timeline zero; disabling chase stops its playback and ignores late input', async () => {
	const f = fixture();
	await f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, receive: 'mtc', midiInput: 'in', offsetSeconds: 10 });
	f.receive({ frame: 0, rate: '25', direction: 1 });
	await f.session.settled(); assert.equal(f.playing(), false); assert.equal(f.seeks.at(-1), 0);
	f.receive({ frame: 300, rate: '25', direction: 1 });
	await f.session.settled(); assert.equal(f.playing(), true);
	await f.session.configure(DEFAULT_TIMECODE_SYNC_SETTINGS);
	assert.equal(f.playing(), false);
	const seeks = f.seeks.length;
	f.receive({ frame: 400, rate: '25', direction: 1 });
	await f.session.settled(); assert.equal(f.seeks.length, seeks);
	await f.session.dispose();
});

test('project switch retires sync without touching the new project transport', async () => {
	const f = fixture();
	await f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, receive: 'ltc' });
	f.receive({ frame: 250, rate: '25', direction: 1 }); await f.session.settled();
	f.setProject('new-project'); f.advance(1);
	await f.session.settled();
	assert.equal(f.session.getSnapshot().active, false); assert.equal(f.paused(), 0);
	await f.session.dispose(); assert.equal(f.closed(), 1);
});

test('invalid settings and incompatible receive state never acquire devices; admission failure stays inactive', async () => {
	const f = fixture();
	await assert.rejects(f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, offsetSeconds: NaN }), /Invalid/);
	f.setReceiveBlocked(true);
	await assert.rejects(f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, receive: 'ltc' }), /normal playback/);
	f.setReceiveBlocked(false); f.setBlocked(true);
	await assert.rejects(f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, sendLtc: true }), /open project/);
	f.setBlocked(false);
	f.io.open = async () => { throw new Error('Device busy'); };
	await assert.rejects(f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, sendLtc: true }), /Device busy/);
	assert.equal(f.session.getSnapshot().active, false); assert.equal(f.session.getSnapshot().error, 'Device busy');
	await f.session.dispose();
});

test('MTC receive locates without autoplay, chases moving timecode with offset, and pauses on signal loss', async () => {
	const f = fixture();
	await f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, receive: 'mtc', midiInput: 'in', offsetSeconds: 3600 });
	f.receive({ frame: 90250, rate: '25', direction: 0 });
	await f.session.settled();
	assert.equal(f.playing(), false); assert.equal(f.seeks.at(-1), 480000);
	f.receive({ frame: 90252, rate: '25', direction: 1 });
	await f.session.settled(); assert.equal(f.playing(), true);
	f.advance(501); await f.session.settled();
	assert.equal(f.playing(), false); assert.equal(f.session.getSnapshot().locked, false);
	await f.session.dispose();
});

test('disabling during device admission closes late devices and ignores stale messages', async () => {
	const f = fixture();
	let release!: (session: TimecodeIoSession) => void;
	let admitted!: () => void;
	const signals: AbortSignal[] = [];
	const opening = new Promise<void>(resolve => { admitted = resolve; });
	f.io.open = (_settings, _receive, _fail, signal) => new Promise(resolve => { if (signal) signals.push(signal); release = resolve; admitted(); });
	const pending = f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, sendLtc: true });
	await opening;
	await f.session.configure(DEFAULT_TIMECODE_SYNC_SETTINGS);
	assert.equal(signals[0]?.aborted, true);
	let closed = false;
	release({ sendMidi: () => {}, clearMidi: () => {}, updateLtc: () => {}, close: async () => { closed = true; } });
	await pending;
	assert.equal(closed, true); assert.equal(f.session.getSnapshot().active, false);
	await f.session.dispose();
});

test('LTC audio activation runs synchronously in the initiating gesture and always releases unused preparation', async () => {
	const f = fixture();
	let prepared = 0, released = 0;
	f.io.prepare = () => { prepared++; return async () => { released++; }; };
	const configuration = f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, sendLtc: true });
	assert.equal(prepared, 1);
	await configuration; assert.equal(released, 1);
	await f.session.dispose();
});

test('audio activation failure retires an existing sender and reports the failure', async () => {
	const f = fixture();
	await f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, sendMtc: true, midiOutput: 'out' });
	f.io.prepare = () => { throw new Error('Audio clock unavailable'); };
	await assert.rejects(f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, sendLtc: true }), /Audio clock unavailable/);
	assert.equal(f.closed(), 1);
	assert.equal(f.session.getSnapshot().error, 'Audio clock unavailable');
	await f.session.dispose();
});

test('a retired chase completion never pauses a newly configured project', async () => {
	let projectId = 'old', playing = false, receive!: (reading: TimecodeReading, timestamp: number) => void;
	let finishOldPlay!: () => void;
	const paused: string[] = [];
	const session = createTimecodeSyncSession({ now: () => 1000, schedule: () => () => {},
		io: { devices: async () => ({ midiInputs: [], midiOutputs: [], audioInputs: [], audioOutputs: [] }),
			open: async (_settings, handler) => { receive = handler; return { sendMidi() {}, clearMidi() {}, updateLtc() {}, close: async () => {} }; } },
		read: () => ({ projectId, playing, sampleRate: 48000, positionFrame: 0, speed: 1, blocked: false }),
		seek() {}, play: () => new Promise<void>(resolve => { finishOldPlay = resolve; }),
		pause: async () => { paused.push(projectId); playing = false; },
	});
	try {
		await session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, receive: 'mtc' });
		receive({ frame: 25, rate: '25', direction: 1 }, 1000);
		projectId = 'new'; playing = true;
		await session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, sendMtc: true });
		finishOldPlay(); await session.settled();
		assert.deepEqual(paused, []); assert.equal(playing, true);
	} finally { await session.dispose(); }
});

test('reconfiguration waits for a retiring timecode device even across superseded choices', async () => {
	const f = fixture();
	const closed = deferred<void>();
	let closeStarted = false;
	const opened: string[] = [];
	const open = f.io.open;
	f.io.open = async (settings, ...args) => {
		opened.push(settings.midiOutput ?? '');
		const device = await open(settings, ...args);
		return settings.midiOutput === 'first' ? { ...device, close: async () => {
			closeStarted = true;
			await closed.promise;
		} } : device;
	};
	await f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, sendMtc: true, midiOutput: 'first' });
	const second = f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, sendMtc: true, midiOutput: 'second' });
	assert.equal(closeStarted, true);
	const third = f.session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, sendMtc: true, midiOutput: 'third' });
	try {
		await settle();
		assert.deepEqual(opened, ['first']);
	} finally {
		closed.resolve();
		await Promise.all([second, third]);
		await f.session.dispose();
	}
	assert.deepEqual(opened, ['first', 'third']);
});

test('a timecode locate awaiting Pause cannot seek a newly opened project', async () => {
	const paused = deferred<void>();
	let projectId = 'old', playing = true, receive!: (reading: TimecodeReading, timestamp: number) => void;
	const sought: string[] = [];
	const session = createTimecodeSyncSession({ now: () => 1000, schedule: () => () => {},
		io: { devices: async () => ({ midiInputs: [], midiOutputs: [], audioInputs: [], audioOutputs: [] }),
			open: async (_settings, handler) => { receive = handler; return { sendMidi() {}, clearMidi() {}, updateLtc() {}, close: async () => {} }; } },
		read: () => ({ projectId, playing, sampleRate: 48000, positionFrame: 0, speed: 1, blocked: false }),
		seek() { sought.push(projectId); }, play: async () => {},
		pause: async () => { await paused.promise; playing = false; },
	});
	try {
		await session.configure({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, receive: 'mtc' });
		receive({ frame: 25, rate: '25', direction: 0 }, 1000);
		projectId = 'new';
		paused.resolve();
		await session.settled();
		assert.deepEqual(sought, []);
		assert.equal(session.getSnapshot().locked, false);
	} finally { await session.dispose(); }
});
