/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { setRecordingTrackRoute, type RecordingRoute } from '../src/common/editor/recording-routing.js';
import RecordingInputSelectors from '../src/common/editor/ui/RecordingInputSelectors.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { TRACK_COPY_BY_LOCALE } from '../src/common/i18n/track-copy.js';
import { createRecordingCaptureFixture, createScope } from './fixtures/recording-capture-fixture.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const [fromWidth, toWidth, start, occupied, expected] of [
	[1, 2, 2, false, 2], [2, 1, 2, false, 2], [1, 2, 2, true, 0], [1, 2, 1, false, 0],
] as const) test(`recording input ${start + 1}, ${fromWidth}→${toWidth} channels retains its available bank (occupied:${occupied})`, async context => {
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
	const capture = createRecordingCaptureFixture({ streamChannelCount: 4 });
	capture.state.recordingRouting = { routes: { 'track-1': { kind: 'device', deviceId: 'mic', channelStart: start, channelCount: fromWidth },
		...(occupied ? { 'track-2': { kind: 'device' as const, deviceId: 'mic', channelStart: 3, channelCount: 1 } } : {}) }, offsets: {} };
	const track = { id: 'track-1', name: 'Microphone', type: 'audio' };
	const controller = { actions: { recording: { setTrackInput(_track: string, route: RecordingRoute | null) {
		capture.state.recordingRouting = setRecordingTrackRoute(capture.state.recordingRouting, track, route);
	} } } };
	await act(async () => { root.render(<RecordingInputSelectors controller={controller} recordingInputs={{
		routes: capture.state.recordingRouting.routes, devices: [{ deviceId: 'mic', label: 'Interface', channelCount: 4, status: 'open' }],
	}} track={track} copy={{ ...ENGLISH_COPY, ...TRACK_COPY_BY_LOCALE.en }} run={(operation: () => unknown) => operation()} />); });
	const width = dom.container.querySelectorAll('select')[1];
	assert.ok(width);
	await act(async () => { reactProps(width).onChange?.({ currentTarget: { value: String(toWidth) } }); });
	await createRoutedRecordingCaptureService(capture.runtime).capture({}, createScope(() => true));
	const recorder = capture.recorderOptionsList[0];
	const frameStart = capture.recorderStartOptions[0]?.startFrame;
	assert.ok(recorder && frameStart !== undefined);
	const channels = Array.from({ length: 4 }, (_, channel) => new Float32Array(4).fill((channel + 1) / 10));
	await recorder.onChunk({ frameStart, frames: 4, channels });
	assert.deepEqual(capture.writerRecords[0]!.writes[0], channels.slice(expected, expected + toWidth),
		'the next take must retain the selected physical microphone rather than silently recording input one');
	assert.equal(capture.state.recordingRouting.routes['track-1']!.channelStart, expected);
});
