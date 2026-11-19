/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { useFramescaperVideoProxyPreviewPressure } from '../src/common/editor/ui/workspace/framescaper-video-proxy-pressure.ts';
import { resolveFramescaperVideoProxyUseRetime, type FramescaperVideoProxyPressureRetime } from '../src/framescaper/editor-video-proxy-use-policy-retime.ts';

Reflect.set(globalThis, 'React', React);

test('automatic proxy demand follows physical Retina pixels and chosen preview resolution', async () => {
	const dom = installReactTestDom();
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
	Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 2 });
	const previousAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
	Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const reports: FramescaperVideoProxyPressureRetime[] = [];
	const canvas = { current: { clientWidth: 960, clientHeight: 540,
		getBoundingClientRect: () => ({ width: 960, height: 540 }) } as HTMLCanvasElement };
	const elements = { current: new Map<string, HTMLVideoElement>() };
	const reporter = (_source: string, pressure: FramescaperVideoProxyPressureRetime) => { reports.push(pressure); };
	const run = (operation: () => Promise<void>) => operation();
	function Probe({ previewResolution }: { previewResolution: 'full' | 'half' }) {
		useFramescaperVideoProxyPreviewPressure({ canvas, elements, reporter, run,
			entries: [{ clipId: 'clip', sourceId: 'source' }], referenceWidth: 1920, referenceHeight: 1080,
			playing: false, previewResolution });
		return null;
	}
	try {
		await act(async () => { root.render(<Probe previewResolution="full" />); });
		assert.equal(reports.at(-1)?.viewportScale, 1);
		assert.equal(resolveFramescaperVideoProxyUseRetime({ purpose: 'preview', mode: 'auto',
			originalAvailable: true, proxyTrust: 'verified', pressure: reports.at(-1) }).kind, 'original');
		await act(async () => { root.render(<Probe previewResolution="half" />); });
		assert.equal(reports.at(-1)?.viewportScale, 0.5);
	} finally {
		await act(async () => { root.unmount(); }); dom.restore();
		Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
		if (prior) Object.defineProperty(globalThis, 'devicePixelRatio', prior); else Reflect.deleteProperty(globalThis, 'devicePixelRatio');
	}
});
