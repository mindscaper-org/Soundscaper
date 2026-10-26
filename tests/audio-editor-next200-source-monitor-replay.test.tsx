/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import SourceMonitorPanel from '../src/common/editor/ui/workspace/SourceMonitorPanel.jsx';
import { createSourceMonitorService } from '../src/common/editor/controller/clip-video/internal/source-monitor-service.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Reflect.set(globalThis, 'React', React);

for (const frames of [1, 22]) test(`natural source end preserves the native replay boundary for ${frames} frames`, async () => {
	const f = await fixture(frames);
	try {
		await act(async () => { reactProps(f.play()).onClick(); });
		Reflect.set(f.video, 'currentTime', frames / 25); Reflect.set(f.video, 'ended', true);
		await act(async () => { reactProps(f.video).onEnded(); });
		assert.equal(f.monitor.view().positionFrame, frames - 1);
		assert.equal(Reflect.get(f.video, 'currentTime'), frames / 25, 'natural end must retain the native replay boundary');
		assert.equal(reactProps(f.play())['aria-pressed'], false);
		if (frames > 1) {
			await act(async () => { f.monitor.seek(5); });
			assert.equal(Reflect.get(f.video, 'currentTime'), f.monitor.view().mediaSeconds, 'manual seek away from end still positions its frame');
		}
	} finally { await f.close(); }
});

test('manual stopped source positioning includes the last frame without claiming native end', async () => {
	const f = await fixture(22);
	try {
		Reflect.set(f.video, 'ended', false);
		await act(async () => { f.monitor.seek(21); });
		assert.equal(Reflect.get(f.video, 'currentTime'), f.monitor.view().mediaSeconds);
		assert.notEqual(Reflect.get(f.video, 'currentTime'), 22 / 25);
		await act(async () => { f.monitor.step(-1); });
		assert.equal(Reflect.get(f.video, 'currentTime'), f.monitor.view().mediaSeconds);
	} finally { await f.close(); }
});

async function fixture(frames: number) {
	const dom = installReactTestDom();
	const global = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = global.IS_REACT_ACT_ENVIRONMENT; global.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let render = (): void => undefined;
	const monitor = createSourceMonitorService({ lifetime: { assertActive() {} },
		getProject: () => ({ id: 'source-replay', sources: [{ id: 'camera', kind: 'video', name: 'Camera',
			sourceFrameCount: frames, frameRate: { num: 25, den: 1 } }] }),
		publishProjectState: () => { render(); },
	});
	monitor.openSource('camera');
	render = () => root.render(<SourceMonitorPanel
		controller={{ actions: { video: { sourceMonitor: monitor, getSourceVisualData: () => ({ mediaUrl: 'source.mp4' }) } } }}
		snapshot={{ readOnly: false }} copy={{}} blocked={false} run={(operation: () => unknown) => operation()} />);
	await act(async () => { render(); });
	const video = dom.one('video');
	Reflect.set(video, 'play', () => Promise.resolve()); Reflect.set(video, 'pause', () => undefined);
	return { video, monitor, play: () => dom.one('[data-source-monitor-action="play"]'),
		async close() { await act(async () => { root.unmount(); }); dom.restore(); global.IS_REACT_ACT_ENVIRONMENT = previous; } };
}
