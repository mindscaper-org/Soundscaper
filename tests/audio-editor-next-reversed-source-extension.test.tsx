/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import { clipSourceDisplayRange } from '../src/common/editor/clip-source-timing.ts';
import type { ClipSourceController, ClipSourceProject } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const reversed of [false, true]) for (const speed of [.5, 2]) for (const edge of ['start', 'end'] as const) {
	for (const sourceRate of [24_000, 48_000]) test(`Source ${edge} extension uses the unused-media clock (${sourceRate}Hz,${speed}x,reversed=${String(reversed)})`, async () => {
		const dom = installReactTestDom();
		const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = environment.IS_REACT_ACT_ENVIRONMENT; environment.IS_REACT_ACT_ENVIRONMENT = true;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const source = { id: 'source', sampleRate: sourceRate, frameCount: 4000, channelCount: 1 };
		const clip = { id: 'clip', sourceId: source.id, kind: 'audio', anchor: 'sample', reversed,
			timelineStartFrame: 0, sourceStartFrame: 1000, sourceDurationFrames: 2000,
			durationFrames: 2000 * 48_000 / sourceRate / speed, speedRatio: speed, warpMap: null };
		const project: ClipSourceProject = { id: 'source-extension', sampleRate: 48_000,
			tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
			sources: [source], clips: [clip] };
		const trims: Readonly<Record<string, number>>[] = [];
		const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
			clip: { update() {} }, timeline: {}, effects: { setSourceSelection() {} },
			audioWarp: { addSourceMarker() {}, moveSourceMarker() {}, deleteSourceMarker() {} },
			clipSourcePreview: { focus() {}, blur() {}, playPause() {}, stop() {}, seek() {},
				setLoop() {}, setLoopRange() {}, setSelection() {}, trim(_id, changes) { trims.push(changes); },
				subscribe: () => () => {}, snapshot: () => ({ clipId: null, focused: false, state: 'stopped',
					positionFrame: 0, loop: false, loopRange: null }) },
		} };
		try {
			await act(async () => root.render(<ClipSourceEditor controller={controller} project={project} clipId="clip"
				run={operation => operation()} copy={{}} blocked={false} />));
			const wave = dom.one('.audio-editor-source-wave-area'), handle = dom.one(`.audio-editor-source-trim--${edge}`);
			Object.defineProperty(wave, 'getBoundingClientRect', { value: () => ({ left: 0, width: 600 }) });
			const range = clipSourceDisplayRange(clip, source, project.sampleRate);
			const initial = edge === 'start' ? range.startFrame : range.endFrame;
			const desired = edge === 'start' ? range.startFrame - 500 * 48_000 / sourceRate : range.endFrame + 500 * 48_000 / sourceRate;
			const pointer = (frame: number) => ({ target: handle, button: 0, buttons: 1, pointerId: 1,
				isPrimary: true, clientX: frame / range.totalFrames * 600, clientY: 0,
				preventDefault() {}, stopPropagation() {} });
			await act(async () => reactProps(handle).onPointerDown(pointer(initial)));
			await act(async () => reactProps(wave).onPointerUp(pointer(desired)));
			assert.deepEqual(trims, [{ sourceStartFrame: edge === 'start' ? 500 : 1000,
				sourceDurationFrames: 2500, durationFrames: clip.durationFrames * 1.25 }]);
		} finally {
			await act(async () => root.unmount()); environment.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
		}
	});
}
