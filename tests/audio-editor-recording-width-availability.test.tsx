/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { normalizeRecordingRouting, setRecordingTrackRoute, type RecordingRoute } from '../src/common/editor/recording-routing.js';
import RecordingInputSelectors from '../src/common/editor/ui/RecordingInputSelectors.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const track = createAudioTrack({ id: 'track', name: 'Voice' });
const peer = createAudioTrack({ id: 'peer', name: 'Other microphone' });
const mono = (channelStart: number, deviceId = 'mic'): RecordingRoute => ({ kind: 'device', deviceId, channelStart, channelCount: 1 });
const copy = { recordingInputSource: 'Recording source', trackChannels: 'Track channels', mono: 'Mono', stereo: 'Stereo',
	recordingInputChannel: 'Channel', recordingInputUnassigned: 'Unassigned', recordingDesktopAudio: 'Desktop audio',
	recordingMonoChannel: 'Mono {channel}', recordingStereoChannels: 'Stereo {left}–{right}' };

for (const channels of [2, 4]) test(`a ${channels}-channel input offers no Stereo width when every bank conflicts`, async context => {
	const fixture = await mount(context, channels, [1, ...(channels === 4 ? [3] : [])]);
	const width = fixture.dom.container.querySelectorAll('select')[1];
	assert.ok(width);
	const stereo = width.options[1];
	assert.ok(stereo);
	assert.equal(stereo.hasAttribute('disabled'), true);
	assert.equal(width.options[0]!.hasAttribute('disabled'), false);
	// A queued native change must not synthesize a conflicting input-one fallback.
	await act(async () => { reactProps(width).onChange?.({ currentTarget: { value: '2' } }); });
	assert.equal(fixture.attempts.length, 0);
	assert.equal(fixture.routing.routes.track?.channelCount, 1);
	await fixture.releasePeers();
	assert.equal(stereo.hasAttribute('disabled'), false);
	await act(async () => { reactProps(width).onChange?.({ currentTarget: { value: '2' } }); });
	assert.equal(fixture.attempts.length, 1);
	assert.deepEqual([fixture.routing.routes.track?.channelStart, fixture.routing.routes.track?.channelCount], [0, 2]);
});

for (const [start, occupied, expected] of [[2, 1, 2], [2, 3, 0]] as const) test(`Stereo retains input ${start + 1} or selects a genuinely available bank (${occupied + 1} occupied)`, async context => {
	const fixture = await mount(context, 4, [occupied], start);
	const width = fixture.dom.container.querySelectorAll('select')[1];
	assert.ok(width);
	assert.equal(width.options[1]!.hasAttribute('disabled'), false);
	await act(async () => { reactProps(width).onChange?.({ currentTarget: { value: '2' } }); });
	assert.deepEqual([fixture.routing.routes.track?.channelStart, fixture.routing.routes.track?.channelCount], [expected, 2]);
});

test('hardware Mono limits and whole-selector editing admission remain intact', async context => {
	const fixture = await mount(context, 1, [], 0, true);
	const selects = fixture.dom.container.querySelectorAll('select');
	assert.equal(selects.length, 3);
	for (const select of selects) assert.equal(select.hasAttribute('disabled'), true);
	assert.equal(selects[1]!.options[1]!.hasAttribute('disabled'), true);
	await act(async () => { reactProps(selects[1]!).onChange?.({ currentTarget: { value: '1' } }); });
	assert.equal(fixture.attempts.length, 0);
});

test('Desktop routing offers only its supported first channel while hardware Mono2 remains editable', async context => {
	const fixture = await mount(context, 2, [], 0, false, true);
	const channel = fixture.dom.container.querySelectorAll('select')[2];
	assert.ok(channel);
	assert.equal(channel.options.length, 1);
	assert.equal(channel.options[0]?.textContent, 'Mono 1');
	await act(async () => { reactProps(channel).onChange?.({ currentTarget: { value: '1' } }); });
	assert.equal(fixture.attempts.length, 0);
	assert.equal(fixture.routing.routes.track?.channelStart, 0);
});

test('hardware Mono2 remains an admitted channel choice', async context => {
	const fixture = await mount(context, 2, []);
	const channel = fixture.dom.container.querySelectorAll('select')[2];
	assert.ok(channel);
	assert.equal(channel.options.length, 2);
	await act(async () => { reactProps(channel).onChange?.({ currentTarget: { value: '1' } }); });
	assert.equal(fixture.routing.routes.track?.channelStart, 1);
});

async function mount(context: TestContext, channels: number, occupied: readonly number[], start = 0, disabled = false, display = false) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const oldAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const oldReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = oldAct;
		if (oldReact) Object.defineProperty(globalThis, 'React', oldReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	});
	const tracks = [track, ...occupied.map((_, index) => ({ ...peer, id: `peer-${index}` }))];
	let routing = normalizeRecordingRouting({ routes: { track: display ? { kind: 'display', channelStart: 0, channelCount: 1 } : mono(start),
		...Object.fromEntries(occupied.map((channel, index) => [`peer-${index}`, mono(channel)])) } }, tracks);
	const attempts: (RecordingRoute | null)[] = [];
	const controller = { actions: { recording: { setTrackInput(id: string, route: RecordingRoute | null) {
		attempts.push(route); routing = setRecordingTrackRoute(routing, { ...track, id }, route);
	} } } };
	const render = async () => { await act(async () => { root.render(<RecordingInputSelectors controller={controller}
		recordingInputs={{ routes: routing.routes, devices: [{ deviceId: 'mic', label: 'Interface', channelCount: channels, status: 'open' }] }}
		track={track} copy={copy} run={(operation: () => unknown) => operation()} displayAudioSupported={false} disabled={disabled} />); }); };
	await render();
	return { dom, attempts, get routing() { return routing; }, async releasePeers() {
		routing = normalizeRecordingRouting({ routes: { track: routing.routes.track } }, tracks); await render();
	} };
}
