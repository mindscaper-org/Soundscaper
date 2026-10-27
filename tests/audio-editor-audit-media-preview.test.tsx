/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import SourceMonitorPanel from '../src/common/editor/ui/workspace/SourceMonitorPanel.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { AudioEditorListeningGainContext, AudioEditorListeningOutputDeviceContext, useAudioEditorListeningMedia } from '../src/common/editor/ui/audio-editor-listening-preview.tsx';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
test('inactive source monitors capture their playhead and pause without resuming when shown', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const captures: number[] = [];
	let seconds = 0, pauses = 0;
	const controller = { actions: { video: { getSourceVisualData: () => ({ mediaUrl: 'source.mp4' }), sourceMonitor: { view: () => ({ sourceId: 'source', mediaSeconds: seconds, positionFrame: Math.floor(seconds * 25), sourceFrameCount: 100 }), seekMediaTime(value: number) { captures.push(value); seconds = value; } } } } };
	const render = (active: boolean) => <SourceMonitorPanel controller={controller} snapshot={{ readOnly: false }} copy={{}} run={(operation: () => unknown) => operation()} blocked={false} panelActive={active} />;
	try {
		await act(async () => root.render(render(true)));
		const video = dom.one('video');
		Reflect.set(video, 'play', () => Promise.resolve());
		Reflect.set(video, 'pause', () => { pauses++; });
		await act(async () => reactProps(dom.one('[data-source-monitor-action="play"]')).onClick?.());
		Reflect.set(video, 'currentTime', 0.42);
		await act(async () => root.render(render(false)));
		assert.deepEqual(captures, [0.42]);
		assert.ok(pauses > 0);
		assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], false);
		await act(async () => root.render(render(true)));
		assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], false);
		assert.equal(Reflect.get(video, 'currentTime'), 0.42);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('video auditions inherit live listening gain through the shared media owner', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	function Audition() { const video = React.useRef<HTMLVideoElement>(null); const ready = useAudioEditorListeningMedia(video, 'blob:highlight'); return <video ref={video} controls={ready} src="blob:highlight" />; }
	const render = (gain: number) => <AudioEditorListeningGainContext.Provider value={gain}><AudioEditorListeningOutputDeviceContext.Provider value="chosen-speakers"><Audition /></AudioEditorListeningOutputDeviceContext.Provider></AudioEditorListeningGainContext.Provider>;
	try {
		await act(async () => root.render(render(0)));
		const video = dom.one('video');
		assert.equal(Reflect.get(video, 'volume'), 0);
		Reflect.set(video, 'currentTime', 0.42);
		await act(async () => root.render(render(0.25)));
		assert.equal(Reflect.get(video, 'volume'), 0.25);
		assert.equal(Reflect.get(video, 'currentTime'), 0.42);
		assert.equal(dom.one('video'), video);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
