/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import ProjectBinPanel from '../src/common/editor/ui/workspace/ProjectBinPanel.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const kind of ['audio', 'video'] as const) {
	test(`MP36: a linked ${kind} file picker cannot import into a replacement project`, async () => {
		const dom = installReactTestDom();
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
		let project = { id: 'project-a', revision: 0, tracks: [], sources: [], projectBin: { clips: [] } };
		const imported: string[] = [], released: unknown[] = [];
		let resolveChoice: (value: { file: File; locatorId: string; locatorRevision: string }) => void = () => undefined;
		const choice = new Promise<{ file: File; locatorId: string; locatorRevision: string }>((resolve) => { resolveChoice = resolve; });
		const controller = { getSnapshot: () => ({ project }), actions: { projectBin: {}, project: {
			importFiles: async () => { imported.push(project.id); },
		} } };
		const release = async (reference: unknown) => { released.push(reference); return true; };
		const fileService = { linkedAudioOriginalsAvailable: kind === 'audio', linkedVideoOriginalsAvailable: kind === 'video',
			chooseLinkedAudioOriginal: () => choice, chooseLinkedVideoOriginal: () => choice,
			releaseLinkedAudioOriginal: release, releaseLinkedVideoOriginal: release };
		let operation: Promise<unknown> = Promise.resolve();
		const run = (callback: () => unknown) => { operation = Promise.resolve(callback()); void operation.catch(() => undefined); };
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const render = async () => { await act(async () => root.render(<ProjectBinPanel controller={controller}
			snapshot={{ project, missingSourceIds: [] }} copy={ENGLISH_COPY} locale="en" fileService={fileService}
			run={run} blocked={false} />)); };
		try {
			await render();
			const label = kind === 'audio' ? ENGLISH_COPY.projectBinLinkAudio : ENGLISH_COPY.projectBinLinkVideo;
			const button = dom.container.querySelectorAll('button').find((candidate) => candidate.textContent === label);
			assert.ok(button, `linked ${kind} picker is exposed in the actual Project Bin`);
			await act(async () => { reactProps(button).onClick?.(); });
			project = { ...project, id: 'project-b' }; await render();
			await act(async () => {
				resolveChoice({ file: new File(['media'], kind === 'audio' ? 'take.wav' : 'take.mp4'),
					locatorId: 'chosen-locator', locatorRevision: 'chosen-revision' });
				await operation;
			});
			assert.deepEqual(imported, []);
			assert.deepEqual(released, [{ locatorId: 'chosen-locator', locatorRevision: 'chosen-revision' }]);
		} finally {
			await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}

test('MP36: a replacement picker opened for an old bin clip cannot target a new project with reused IDs', async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.assign(globalThis.window, { getComputedStyle: () => ({ display: '', visibility: '' }) });
	const clip = { id: 'shared-clip', kind: 'audio', sourceId: 'source', title: 'Recording', durationFrames: 8,
		sourceDurationFrames: 8, sourceStartFrame: 0 };
	let project = { id: 'project-a', revision: 0, sampleRate: 48_000, tracks: [], clips: [],
		sources: [{ id: 'source', kind: 'audio', frameCount: 8, sampleRate: 48_000, channelCount: 1 }], projectBin: { clips: [clip] } };
	const prepared: string[] = [];
	const controller = { getSnapshot: () => ({ project }), actions: { project: {}, projectBin: {
		getVisualData: () => null, instanceCount: () => 0,
		prepareReplacement: async () => { prepared.push(project.id); return null; },
	} } };
	const fileService = { linkedAudioOriginalsAvailable: false, linkedVideoOriginalsAvailable: false };
	let operation: Promise<unknown> = Promise.resolve();
	const run = (callback: () => unknown) => { operation = Promise.resolve(callback()); void operation.catch(() => undefined); };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async () => { await act(async () => root.render(<div id="kw-audio-editor-design-system">
		<div data-editor-overlay-layer /><ProjectBinPanel controller={controller} snapshot={{ project, missingSourceIds: [] }}
			copy={ENGLISH_COPY} locale="en" fileService={fileService} run={run} blocked={false} /></div>)); };
	try {
		await render();
		const binInput = dom.one('[data-project-bin-input]');
		const originalClosest = binInput.closest.bind(binInput);
		Object.defineProperty(binInput, 'closest', { configurable: true, value: (selector: string) =>
			selector === '#kw-audio-editor-design-system' ? dom.one('[id="kw-audio-editor-design-system"]') : originalClosest(selector) });
		const overflow = dom.one('.kw-audio-editor__project-bin-overflow');
		await act(async () => { reactProps(overflow).onClick?.({ currentTarget: overflow }); });
		const replace = dom.container.querySelectorAll('[role="menuitem"]').find((item) => item.textContent === ENGLISH_COPY.projectBinReplace);
		assert.ok(replace);
		const input = dom.one('[data-project-bin-replacement-input]'); Object.assign(input, { click() {} });
		await act(async () => { reactProps(replace).onClick?.({ currentTarget: replace, stopPropagation() {} }); });
		project = { ...project, id: 'project-b' }; await render();
		await act(async () => {
			reactProps(input).onChange?.({ currentTarget: { files: [new File(['replacement'], 'replacement.wav')], value: '' } });
			await operation;
		});
		assert.deepEqual(prepared, []);
	} finally {
		await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
