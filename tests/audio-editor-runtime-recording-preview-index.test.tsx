/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';
import { registerMockModuleUrls } from './helpers/mock-module-urls.ts';

void test('late visible recording rows share one first-match preview index per publication', async context => {
	const rowUrl = `data:text/javascript,${encodeURIComponent('export const seen = new Map(); export function MemoizedAudioTrackRow({track, recordingPreview}) { seen.set(track.id, recordingPreview); return null; }')}`;
	const hook = registerMockModuleUrls({ './MemoizedAudioTrackRow.jsx': rowUrl });
	const { TrackListView } = await import('../src/common/editor/ui/timeline/TrackListView.jsx');
	const { seen } = await import(rowUrl) as { seen: Map<string, unknown> };
	const Component = TrackListView as React.ComponentType<Record<string, unknown>>;
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: class {
		observe() {} unobserve() {} disconnect() {}
	} });
	context.mock.method(ReactTestElement.prototype, 'getBoundingClientRect', function (this: ReactTestElement) {
		const offscreen = this.hasAttribute('data-track-viewport-row') && Number(this.dataset.trackIndex) < 480;
		return { x: 0, y: offscreen ? 10_000 : 0, top: offscreen ? 10_000 : 0, bottom: offscreen ? 10_080 : 80, left: 0, right: 800, width: 800, height: 80 };
	});
	context.after(async () => {
		await act(async () => root.unmount()); dom.restore(); hook.deregister();
		if (previousObserver) Object.defineProperty(globalThis, 'IntersectionObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'IntersectionObserver');
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	});
	let reads = 0;
	const previews = Array.from({ length: 512 }, (_, index) => ({
		get trackId() { reads++; return `track-${index}`; }, durationFrames: index + 1,
	}));
	const tracks = Array.from({ length: 512 }, (_, index) => ({ id: `track-${index}`, type: 'audio', name: `Input ${index}` }));
	const project = { id: 'recording', tracks };
	const controller = { actions: { trackFolders: {} } };
	const render = async (recordingPreviews: readonly unknown[], selectedTrackId = '') => {
		await act(async () => root.render(<div data-timeline><Component project={project} controller={controller}
			snapshot={{ selectedTrackId, preferences: {} }} projectIndex={{ clipsByTrackId: new Map(), clipById: new Map(), sourceById: new Map() }}
			visualTrackHeight={() => 80} copy={{}} locale="en" waveformRulerState={{}}
			isFlatNavigation={true} trackBaseTabIndex={0} selectedClipIdSet={new Set()} recordingPreviews={recordingPreviews} /></div>));
	};
	await render(previews);
	assert.equal(seen.size, 32);
	assert.equal(seen.get('track-511'), previews[511]);
	assert.ok(reads <= 512, `512 previews and 32 late visible rows read ${reads} track IDs; expected one pass`);
	reads = 0; await render(previews, 'track-500');
	assert.equal(reads, 0, 'selection-only publications retain the preview index');
	const replacement = { trackId: 'track-500', durationFrames: 9_000 };
	await render([replacement, ...previews, { trackId: 'track-500', durationFrames: 99_000 }]);
	assert.equal(seen.get('track-500'), replacement, 'the first duplicate retains its original object identity');
	await render([]);
	assert.equal(seen.get('track-500'), null, 'stopped recording removes the previous owner immediately');
});
