/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperVideoProxyDialog from '../src/common/editor/ui/dialogs/FramescaperVideoProxyDialog.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createVideoSource, createVideoClip } from '../src/common/editor/project-media-factory.ts';
import { bindFramescaperVideoProxyActionRuntime, registerFramescaperVideoProxyActionRuntime } from '../src/common/editor/framescaper-video-proxy-action-runtime-registry.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const abandoned of [false, true]) test(`a ${abandoned ? 'closed' : 'current'} proxy dialog owns its selected original`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const source = createVideoSource({ id: 'camera', name: 'Camera.webm', storageKey: 'camera', sourceFrameCount: 30,
		sampleFrameCount: 48_000, width: 320, height: 180, frameRate: { num: 30, den: 1 }, contentSha256: 'ab'.repeat(32) });
	const project = createFramescaperProject(PROFILE, { sources: [source],
		projectBin: { clips: [createVideoClip({ id: 'bin', sourceId: source.id, durationFrames: 48_000 })] } });
	const controller = {};
	const relinks: string[] = [];
	bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'auto', previewTrust: () => 'unavailable', pressure: () => null,
		async setMode() {}, async reportPreviewPressure() {}, async generate() {}, async attachExisting() {}, async detach() {}, async regenerate() {},
		async relinkOriginal(_sourceId, candidate) { relinks.push(candidate.file.name); return 'relinked'; },
	}));
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	let started!: () => void;
	const choosing = new Promise<void>(resolve => { started = resolve; });
	let capturedSignal: AbortSignal | undefined;
	let operation: Promise<unknown> = Promise.resolve();
	try {
		await act(async () => { root.render(<FramescaperVideoProxyDialog controller={controller} snapshot={{ project }}
			editingBlocked={false} copy={{}} fileService={{ linkedVideoOriginalsAvailable: true,
				async chooseLinkedVideoOriginal(request?: Readonly<{ signal?: AbortSignal }>) {
					capturedSignal = request?.signal; started(); await gate;
					return { file: new File(['video'], 'Selected.webm'), locatorId: 'a'.repeat(64), locatorRevision: 'b'.repeat(64) };
				} }} run={work => { operation = Promise.resolve(work()); return operation; }} onClose={() => undefined} />); });
		const button = dom.container.querySelectorAll('button').find(node => node.textContent === 'Relink original');
		assert.ok(button);
		await act(async () => { reactProps(button).onClick?.(); await choosing; });
		if (abandoned) await act(async () => root.unmount());
		await act(async () => { release(); if (abandoned) await assert.rejects(operation, { name: 'AbortError' }); else await operation; });
		assert.deepEqual(relinks, abandoned ? [] : ['Selected.webm'], 'an abandoned native picker must not start a fresh relink');
		if (abandoned) {
			assert.ok(capturedSignal, 'forward close cancellation to native file materialization and locator cleanup');
			assert.equal(capturedSignal.aborted, true);
		}
	} finally {
		release();
		if (!abandoned) await act(async () => root.unmount());
		dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous;
	}
});
