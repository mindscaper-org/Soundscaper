/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import SourceMonitorPanel from '../src/common/editor/ui/workspace/SourceMonitorPanel.jsx';
import { createSourceMonitorService } from '../src/common/editor/controller/clip-video/internal/source-monitor-service.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Reflect.set(globalThis, 'React', React);

test('playing source position updates its readout and scrubber without replacing exact stopped frames', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let render = (): void => undefined;
	const project = { sources: [{ id: 'source', kind: 'video', name: 'Camera', sourceFrameCount: 180,
		frameRate: { num: 30, den: 1 } }] };
	const sourceMonitor = createSourceMonitorService({ getProject: () => project,
		lifetime: { assertActive: () => undefined }, publishProjectState: () => { render(); } });
	sourceMonitor.openSource('source', { positionFrame: 7 });
	const controller = { actions: { video: { sourceMonitor, getSourceVisualData: () => ({ mediaUrl: 'camera.webm' }) } } };
	render = () => root.render(<SourceMonitorPanel controller={controller} snapshot={{ readOnly: false }} copy={{}}
		run={(operation: () => unknown) => operation()} blocked={false} />);
	try {
		await act(async () => { render(); });
		const video = dom.one('video');
		Reflect.set(video, 'play', () => Promise.resolve()); Reflect.set(video, 'pause', () => undefined);
		const update = (): void => { const handler = reactProps(video).onTimeUpdate; if (typeof handler === 'function') handler(); };
		Reflect.set(video, 'currentTime', .3);
		await act(async () => { update(); });
		assert.equal(sourceMonitor.view().positionFrame, 7, 'a stopped exact frame remains authoritative');
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="play"]')).onClick(); });
		Reflect.set(video, 'currentTime', .5);
		await act(async () => { update(); });
		assert.equal(sourceMonitor.view().positionFrame, 15);
		const position: unknown = reactProps(dom.one('[data-source-monitor]'))['data-source-monitor-frame'];
		assert.equal(position, 15);
		const scrub: unknown = reactProps(dom.one('[data-source-monitor-scrub]')).value;
		assert.equal(scrub, 15);
		assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], true);
		await act(async () => { reactProps(dom.one('[data-source-monitor-action="play"]')).onClick(); });
		Reflect.set(video, 'currentTime', .54);
		await act(async () => { update(); });
		assert.equal(sourceMonitor.view().positionFrame, 15);
	} finally {
		await act(async () => { root.unmount(); }); dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
