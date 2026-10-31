/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import SourceMonitorPanel from '../src/common/editor/ui/workspace/SourceMonitorPanel.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Reflect.set(globalThis, 'React', React);

test('source playback publishes its live clock before mark, step, and ending, preserving exact stopped marks', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let frame = 7;
	const calls: string[] = [];
	const sourceMonitor = {
		view: () => ({ sourceId: 'source', sourceName: 'Clip', sourceFrameCount: 25, positionFrame: frame,
			mediaSeconds: frame / 25, timecodeLabel: String(frame), markIn: null, markOut: null }),
		seek: (next: number) => { frame = next; },
		seekMediaTime: (seconds: number) => { calls.push(`seek:${seconds}`); frame = Math.floor(seconds * 25); },
		step: (delta: number) => { frame += delta; calls.push(`step:${frame}`); },
		markIn: () => { calls.push(`in:${frame}`); }, markOut: () => { calls.push(`out:${frame}`); },
		clearMarks: () => undefined,
	};
	try {
		await act(async () => { root.render(<SourceMonitorPanel
			controller={{ actions: { video: { sourceMonitor, getSourceVisualData: () => ({ mediaUrl: 'clip.mp4' }) } } }}
			snapshot={{ readOnly: false }} copy={{}} run={(operation: () => unknown) => operation()} blocked={false} />); });
		const video = dom.one('video');
		Reflect.set(video, 'play', () => Promise.resolve());
		Reflect.set(video, 'pause', () => undefined);
		Reflect.set(video, 'currentTime', 0.32);
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="mark-in"]')).onClick(); });
		assert.deepEqual(calls.splice(0), ['in:7'], 'stopped frame authority must not be replaced by decoder rounding');
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="play"]')).onClick(); });
		Reflect.set(video, 'currentTime', 0.4);
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="mark-in"]')).onClick(); });
		assert.deepEqual(calls.splice(0), ['seek:0.4', 'in:10']);
		assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], true);
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="next"]')).onClick(); });
		assert.deepEqual(calls.splice(0), ['seek:0.4', 'step:11']);
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="play"]')).onClick(); });
		Reflect.set(video, 'currentTime', 0.96);
		await act(async () => { reactProps(video).onEnded(); });
		assert.deepEqual(calls, ['seek:0.96']);
		assert.equal(frame, 24);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});

test('opening a different source clears playback before positioning its stopped media', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let sourceId = 'first';
	let paused = 0;
	const sourceMonitor = { view: () => ({ sourceId, positionFrame: 0, mediaSeconds: 0, sourceFrameCount: 25 }) };
	const render = () => root.render(<SourceMonitorPanel
		controller={{ actions: { video: { sourceMonitor, getSourceVisualData: () => ({ mediaUrl: `${sourceId}.mp4` }) } } }}
		snapshot={{ readOnly: false }} copy={{}} run={(operation: () => unknown) => operation()} blocked={false} />);
	try {
		await act(async () => { render(); });
		const video = dom.one('video');
		Reflect.set(video, 'play', () => Promise.resolve());
		Reflect.set(video, 'pause', () => { paused += 1; });
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="play"]')).onClick(); });
		assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], true);
		Reflect.set(video, 'currentTime', 0.4);
		sourceId = 'second';
		await act(async () => { render(); });
		assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], false);
		assert.equal(paused, 1);
		assert.equal(Reflect.get(video, 'currentTime'), 0);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});

test('Match frame reopening the current source cancels playback but ordinary marks leave it playing', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let openRevision = 1;
	let mediaSeconds = 0;
	let paused = 0;
	const sourceMonitor = {
		view: () => ({ sourceId: 'source', openRevision, positionFrame: 0, mediaSeconds, sourceFrameCount: 25 }),
		seekMediaTime: (seconds: number) => { mediaSeconds = seconds; render(); },
	};
	const render = () => root.render(<SourceMonitorPanel
		controller={{ actions: { video: { sourceMonitor, getSourceVisualData: () => ({ mediaUrl: 'source.mp4' }) } } }}
		snapshot={{ readOnly: false }} copy={{}} run={(operation: () => unknown) => operation()} blocked={false} />);
	try {
		await act(async () => { render(); });
		const video = dom.one('video');
		Reflect.set(video, 'play', () => Promise.resolve());
		Reflect.set(video, 'pause', () => {
			paused += 1;
			// WebKit may deliver the departing clock as the media is paused.
			reactProps(video).onTimeUpdate();
		});
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="play"]')).onClick(); });
		Reflect.set(video, 'currentTime', 0.4);
		mediaSeconds = 0.42;
		await act(async () => { render(); });
		assert.equal(paused, 0);
		assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], true);
		mediaSeconds = 0.22;
		openRevision += 1;
		await act(async () => { render(); });
		assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], false);
		assert.equal(paused, 1);
		assert.equal(Reflect.get(video, 'currentTime'), 0.22);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});

test('a queued playback clock cannot overwrite a same-source Match frame session before React commits', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let openRevision = 1, mediaSeconds = 0;
	const published: number[] = [];
	const sourceMonitor = {
		view: () => ({ sourceId: 'source', openRevision, positionFrame: Math.floor(mediaSeconds * 25), mediaSeconds, sourceFrameCount: 25 }),
		seekMediaTime: (seconds: number) => { published.push(seconds); mediaSeconds = seconds; },
	};
	const render = () => root.render(<SourceMonitorPanel
		controller={{ actions: { video: { sourceMonitor, getSourceVisualData: () => ({ mediaUrl: 'source.mp4' }) } } }}
		snapshot={{ readOnly: false }} copy={{}} run={(operation: () => unknown) => operation()} blocked={false} />);
	try {
		await act(async () => { render(); });
		const video = dom.one('video');
		Reflect.set(video, 'play', () => Promise.resolve());
		Reflect.set(video, 'pause', () => undefined);
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="play"]')).onClick(); });
		const queuedTimeUpdate = reactProps(video).onTimeUpdate;
		Reflect.set(video, 'currentTime', 0.1);
		// Match frame updates its controller synchronously, before React's stop effect.
		openRevision += 1; mediaSeconds = 0.22;
		await act(async () => { queuedTimeUpdate(); render(); });
		assert.deepEqual(published, [], 'The previous playback session has lost clock publication authority.');
		assert.equal(mediaSeconds, 0.22);
		assert.equal(Reflect.get(video, 'currentTime'), 0.22);
		assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], false);
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="play"]')).onClick(); });
		Reflect.set(video, 'currentTime', 0.48);
		await act(async () => { reactProps(video).onTimeUpdate(); });
		assert.deepEqual(published, [0.48], 'A fresh playback session retains normal clock publication.');
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});

test('a newly committed clock handler cannot adopt the previous playback session before passive effects stop it', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let openRevision = 1, mediaSeconds = 0, pauses = 0, dispatched = 0;
	let previousTimeUpdate: unknown;
	const published: number[] = [];
	const sourceMonitor = {
		view: () => ({ sourceId: 'source', openRevision, positionFrame: Math.floor(mediaSeconds * 25), mediaSeconds, sourceFrameCount: 25 }),
		seekMediaTime: (seconds: number) => { published.push(seconds); mediaSeconds = seconds; },
	};
	function PlaybackBoundary({ revision }: { revision: number }) {
		React.useLayoutEffect(() => {
			if (revision === 1) return;
			const currentTimeUpdate = reactProps(dom.one('video')).onTimeUpdate;
			assert.notEqual(currentTimeUpdate, previousTimeUpdate, 'The native event reaches the newly committed handler.');
			assert.equal(pauses, 0, 'The event runs before the passive stop effect.');
			dispatched += 1;
			currentTimeUpdate();
		}, [revision]);
		return <SourceMonitorPanel
			controller={{ actions: { video: { sourceMonitor, getSourceVisualData: () => ({ mediaUrl: 'source.mp4' }) } } }}
			snapshot={{ readOnly: false }} copy={{}} run={(operation: () => unknown) => operation()} blocked={false} />;
	}
	try {
		await act(async () => { root.render(<PlaybackBoundary revision={openRevision} />); });
		const video = dom.one('video');
		Reflect.set(video, 'play', () => Promise.resolve());
		Reflect.set(video, 'pause', () => { pauses += 1; });
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="play"]')).onClick(); });
		previousTimeUpdate = reactProps(video).onTimeUpdate;
		Reflect.set(video, 'currentTime', 0.08);
		openRevision += 1; mediaSeconds = 0.2;
		await act(async () => { root.render(<PlaybackBoundary revision={openRevision} />); });
		assert.equal(dispatched, 1);
		assert.deepEqual(published, [], 'A new render cannot give an old media clock the reopened session identity.');
		assert.equal(mediaSeconds, 0.2);
		assert.equal(Reflect.get(video, 'currentTime'), 0.2);
		assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], false);
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="play"]')).onClick(); });
		Reflect.set(video, 'currentTime', 0.48);
		await act(async () => { reactProps(video).onTimeUpdate(); });
		assert.deepEqual(published, [0.48], 'A newly started playback owns the replacement session clock.');
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
