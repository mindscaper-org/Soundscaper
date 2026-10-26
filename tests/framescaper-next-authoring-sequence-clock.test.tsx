/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperSelectedVisualAuthoringDialog from '../src/common/editor/ui/dialogs/FramescaperSelectedVisualAuthoringDialog.tsx';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { bindFramescaperSelectedAuthoringController } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const entry of ['seconds', 'samples'] as const) test(`dissolve ${entry} entry uses its owning clocks`, async () => {
	const sampleRate = entry === 'samples' ? 44_100 : 48_000;
	let project = createFramescaperProject(PROFILE, { id: 'two-clocks', sampleRate,
		sources: [createVideoSource({ id: 'camera', storageKey: 'camera', name: 'Camera', mimeType: 'video/webm',
			contentSha256: '12'.repeat(32), frameRate: { num: 30, den: 1 }, sourceFrameCount: 240,
			sampleRate, sampleFrameCount: sampleRate * 8, width: 160, height: 90 })],
		clips: ['first', 'second'].map((id, index) => ({ kind: 'video', id, sourceId: 'camera', title: id,
			sequenceId: 'cut', sequenceStartFrame: index * 100, sequenceFrameCount: 100,
			sourceInFrame: index * 120, sourceFrameCount: 120, retimeMap: null })),
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['first', 'second'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: [] },
			{ id: 'cut', rate: { num: 25, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	let didCommit: (() => void) | undefined;
	const committed = new Promise<void>(resolve => { didCommit = resolve; });
	const controller = { get project() { return project; }, getSnapshot: () => ({ selectedClipId: 'first' }),
		getTelemetrySnapshot: () => ({ positionFrame: 0 }), actions: { edit: { commit(command: unknown) {
			project = applyFramescaperProjectCommand(PROFILE, project, command);
			didCommit?.();
		} } } };
	bindFramescaperSelectedAuthoringController({ controller,
		store: createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false }) });
	const dom = installReactTestDom();
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FramescaperSelectedVisualAuthoringDialog surface="video-transition-dissolve"
			controller={controller} project={project} selectedClipId="first" playheadSample={0}
			editingBlocked={false} readOnly={false} run={(operation: () => unknown) => operation()} onClose={() => undefined} />));
		if (entry === 'samples') {
			await act(async () => { reactProps(dom.one('.timecode__format-button')).onClick?.(); });
			const samples = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent === 'samples'); assert.ok(samples);
			await act(async () => { reactProps(samples).onClick?.({ stopPropagation() {} }); });
		}
		await act(async () => { reactProps(dom.one('.timecode__display')).onDoubleClick?.({}); });
		const input = dom.one('.timecode').querySelector('input'); assert.ok(input);
		await act(async () => { reactProps(input).onChange?.({ currentTarget: { value: entry === 'samples' ? String(sampleRate) : '1s' } }); });
		await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); });
		const value: unknown = reactProps(dom.one('[data-timecode-direct-entry]')).value;
		assert.equal(value, 25, 'one second must author 25 owning frames, not 30 primary frames');
		await act(async () => { reactProps(dom.one('[data-framescaper-authoring-apply]')).onClick?.();
			await committed; });
		const transitions: unknown = project.tracks.find(track => track.id === 'pictures')?.videoTransitions;
		assert.ok(Array.isArray(transitions));
		const transition: unknown = transitions[0];
		assert.ok(transition && typeof transition === 'object' && 'durationFrames' in transition);
		assert.equal(transition.durationFrames, 25);
	} finally {
		await act(async () => root.unmount()); dom.restore();
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
	}
});
