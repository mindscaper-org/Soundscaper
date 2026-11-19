/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserTimecodeSyncIo, type TimecodeBrowserResources } from '../src/common/editor/controller/transport/timecode-sync-browser.ts';
import { DEFAULT_TIMECODE_SYNC_SETTINGS } from '../src/common/editor/controller/transport/timecode-sync-session.ts';
import { deferred } from './helpers/async-test-control.ts';

function ltcFixture() {
	let openedInputs = 0, stoppedInputs = 0, closed = 0;
	const track = {
		getSettings: () => ({ channelCount: 1 }), addEventListener() {}, removeEventListener() {},
		stop() { stoppedInputs++; },
	};
	const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
	const resources: TimecodeBrowserResources = {
		navigator: { mediaDevices: { getUserMedia: async () => { openedInputs++; return stream; } } as unknown as MediaDevices,
			requestMIDIAccess: async () => { throw new Error('LTC uses audio devices'); } },
		createContext: () => ({ state: 'running', resume: async () => {}, close: async () => { closed++; },
			destination: {}, createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
			addEventListener() {}, removeEventListener() {},
		}) as unknown as ReturnType<TimecodeBrowserResources['createContext']>,
		loadWorklet: async () => {}, createNode: () => ({ connect() {}, disconnect() {}, port: { close() {} } }) as unknown as AudioWorkletNode,
		now: () => 1000,
	};
	return { resources, counts: () => ({ openedInputs, stoppedInputs, closed }) };
}

test('receive-only LTC does not require the previously selected output sink', async () => {
	const { resources, counts } = ltcFixture();
	const io = createBrowserTimecodeSyncIo(resources);
	const settings = { ...DEFAULT_TIMECODE_SYNC_SETTINGS, receive: 'ltc' as const, audioOutput: 'previous-output' };
	const session = await io.open(settings, () => {}, () => {});
	await session.close();
	assert.deepEqual(counts(), { openedInputs: 1, stoppedInputs: 1, closed: 1 });
	await assert.rejects(io.open({ ...settings, sendLtc: true }, () => {}, () => {}), /cannot select an LTC audio output/u);
});

test('overlapping MIDI device queries share authorization and retry after a refusal', async () => {
	const { resources } = ltcFixture();
	const admission = deferred<MIDIAccess>();
	let calls = 0, admitting = true;
	const midi = { sysexEnabled: true, inputs: new Map(), outputs: new Map() } as unknown as MIDIAccess;
	const io = createBrowserTimecodeSyncIo({ ...resources, navigator: {
		mediaDevices: { enumerateDevices: async () => [] } as unknown as MediaDevices,
		requestMIDIAccess: () => { calls++; return admitting ? admission.promise : Promise.resolve(midi); },
	} });
	const first = io.devices(true);
	const second = io.devices(true);
	admission.reject(new Error('MIDI access refused'));
	for (const result of await Promise.allSettled([first, second])) assert.equal(result.status, 'rejected');
	assert.equal(calls, 1);
	admitting = false;
	assert.deepEqual(await io.devices(true), { midiInputs: [], midiOutputs: [], audioInputs: [], audioOutputs: [] });
	assert.equal(calls, 2);
});

test('MTC admission refuses a port that disconnected while opening the other port', async () => {
	const { resources } = ltcFixture();
	const outputOpening = deferred<void>(), outputReady = deferred<void>();
	const closed: string[] = [];
	let inputState: MIDIPortDeviceState = 'connected';
	const input = { get state() { return inputState; }, connection: 'closed',
		open: async () => {}, close: async () => { closed.push('input'); }, addEventListener() {}, removeEventListener() {},
	};
	const output = { state: 'connected', connection: 'closed', clear() {},
		open: async () => { outputOpening.resolve(); await outputReady.promise; }, close: async () => { closed.push('output'); },
	};
	const midi = { sysexEnabled: true, inputs: new Map([['input', input]]), outputs: new Map([['output', output]]),
		addEventListener() {}, removeEventListener() {},
	} as unknown as MIDIAccess;
	const io = createBrowserTimecodeSyncIo({ ...resources, navigator: { ...resources.navigator, requestMIDIAccess: async () => midi } });
	const opening = io.open({ ...DEFAULT_TIMECODE_SYNC_SETTINGS, receive: 'mtc', sendMtc: true,
		midiInput: 'input', midiOutput: 'output' }, () => {}, () => {});
	await outputOpening.promise;
	inputState = 'disconnected';
	outputReady.resolve();
	await assert.rejects(opening.then(async session => { await session.close(); }), /MIDI port disconnected/u);
	assert.deepEqual(closed.sort(), ['input', 'output']);
});
