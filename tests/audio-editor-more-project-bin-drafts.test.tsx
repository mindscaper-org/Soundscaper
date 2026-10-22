/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import ProjectBinPanel from '../src/common/editor/ui/workspace/ProjectBinPanel.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const sameId of [false, true]) test(`MP37: a bin name draft cannot rename a replacement clip with ${sameId ? 'the same' : 'a different'} project ID`, async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const clip = { id: 'shared-clip', kind: 'audio', sourceId: 'source', title: 'Recording', durationFrames: 8,
		sourceDurationFrames: 8, sourceStartFrame: 0 };
	let project = { id: 'project-a', revision: 0, sampleRate: 48_000, tracks: [], clips: [],
		sources: [{ id: 'source', kind: 'audio', frameCount: 8, sampleRate: 48_000, channelCount: 1 }], projectBin: { clips: [clip] } };
	const renamed: string[] = [];
	let generation = 1;
	const controller = { captureProjectGeneration: () => ({ projectId: project.id, generation }), getSnapshot: () => ({ project }), actions: { project: {}, projectBin: {
		getVisualData: () => null, instanceCount: () => 0,
		rename: (_id: string, name: string) => { renamed.push(`${project.id}:${name}`); },
	} } };
	const fileService = { linkedAudioOriginalsAvailable: false, linkedVideoOriginalsAvailable: false };
	const run = (callback: () => unknown) => { callback(); };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async () => { await act(async () => root.render(<ProjectBinPanel controller={controller}
		snapshot={{ project, missingSourceIds: [] }} copy={ENGLISH_COPY} locale="en" fileService={fileService}
		run={run} blocked={false} />)); };
	try {
		await render();
		await act(async () => { reactProps(dom.one('[data-project-bin-name]')).onChange?.({ currentTarget: { value: 'Private draft for A' } }); });
		project = { ...project, id: sameId ? 'project-a' : 'project-b' }; generation++; await render();
		const currentInput = dom.one('[data-project-bin-name]');
		await act(async () => { reactProps(currentInput).onBlur?.(); });
		assert.deepEqual(renamed, []);
		assert.equal(currentInput.value, 'Recording');
	} finally {
		await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
