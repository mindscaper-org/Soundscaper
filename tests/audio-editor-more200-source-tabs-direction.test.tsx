/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipSourceMonitorPanel from '../src/common/editor/ui/inspector/ClipSourceMonitorPanel.tsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const direction of ['ltr', 'rtl']) test(`source tabs follow physical horizontal navigation in ${direction}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(window, 'getComputedStyle', { configurable: true, value: () => ({ direction }) });
	const source = createAudioSource({ id: 'source', frameCount: 1_000, channelCount: 1, sampleRate: 48_000 });
	const clips = ['first', 'middle', 'last'].map(id => createAudioClip({ id, title: id, sourceId: source.id, durationFrames: 1_000, sourceDurationFrames: 1_000 }));
	const project = createSoundscaperProject({ id: 'source-tabs', sources: [source], clips,
		tracks: [createAudioTrack({ id: 'track', clipIds: clips.map(clip => clip.id) })] });
	try {
		await act(async () => { root.render(<ClipSourceMonitorPanel controller={{}} run={operation => operation()}
			copy={ENGLISH_COPY} snapshot={{ project, selectedClipIds: clips.map(clip => clip.id), selectedClipId: 'middle' }} />); });
		const tabs = dom.container.querySelectorAll('[role="tab"]');
		assert.equal(tabs.length, 3);
		const key = async (value: string, ctrlKey = false) => {
			await act(async () => { reactProps(tabs[1]!).onKeyDown?.({ key: value, ctrlKey, currentTarget: tabs[1], preventDefault() {} }); });
		};
		tabs[1]!.focus();
		await key(direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
		assert.equal(document.activeElement, tabs[2]);
		assert.equal(tabs[2]!.getAttribute('aria-selected'), 'true');
		await key(direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft');
		assert.equal(document.activeElement, tabs[0]);
		await key('Home'); assert.equal(document.activeElement, tabs[0]);
		await key('End'); assert.equal(document.activeElement, tabs[2]);
		tabs[1]!.focus(); await key('ArrowLeft', true); assert.equal(document.activeElement, tabs[1]);
	} finally {
		await act(async () => { root.unmount(); });
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});
