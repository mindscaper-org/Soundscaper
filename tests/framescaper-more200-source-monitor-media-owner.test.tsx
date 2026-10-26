/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import SourceMonitorPanel from '../src/common/editor/ui/workspace/SourceMonitorPanel.jsx';
import { createSourceMonitorService } from '../src/common/editor/controller/clip-video/internal/source-monitor-service.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Reflect.set(globalThis, 'React', React);

for (const replacement of ['proxy', 'unavailable'] as const) {
	test(`a ${replacement} source visual retires the old monitor playback without reopening its source`, async () => {
		const dom = installReactTestDom();
		const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
		environment.IS_REACT_ACT_ENVIRONMENT = true;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const project = { sources: [{ id: 'camera', kind: 'video', name: 'Camera', sourceFrameCount: 180,
			frameRate: { num: 30, den: 1 } }] };
		let render = (): void => undefined;
		const sourceMonitor = createSourceMonitorService({ getProject: () => project,
			lifetime: { assertActive() {} }, publishProjectState: () => { render(); } });
		sourceMonitor.openSource('camera', { positionFrame: 15 });
		const revision = sourceMonitor.view().openRevision;
		let visual = { mediaUrl: 'blob:original', available: true };
		const controller = { actions: { video: { sourceMonitor, getSourceVisualData: () => visual } } };
		render = () => root.render(<SourceMonitorPanel controller={controller} snapshot={{ readOnly: false }} copy={{}}
			run={(operation: () => unknown) => operation()} blocked={false} />);
		try {
			await act(async () => { render(); });
			const video = dom.one('video');
			Reflect.set(video, 'play', () => Promise.resolve());
			Reflect.set(video, 'pause', () => undefined);
			await act(async () => { reactProps(dom.one('[data-source-monitor-action="play"]')).onClick(); });
			assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], true);
			await act(async () => { render(); });
			assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], true,
				'ordinary source position publications keep the same media playing');
			visual = replacement === 'proxy' ? { mediaUrl: 'blob:verified-proxy', available: true }
				: { mediaUrl: 'blob:original', available: false };
			await act(async () => { render(); });
			assert.equal(sourceMonitor.view().openRevision, revision);
			assert.equal(sourceMonitor.view().positionFrame, 15);
			assert.equal(reactProps(dom.one('[data-source-monitor-action="play"]'))['aria-pressed'], false,
				'the native media resource changed and no longer has the previous playing transport');
		} finally {
			await act(async () => root.unmount());
			dom.restore(); environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
