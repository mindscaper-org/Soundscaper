/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperSelectedVisualAuthoringDialog from '../../src/common/editor/ui/dialogs/FramescaperSelectedVisualAuthoringDialog.tsx';
import { createVideoSource } from '../../src/common/editor/project-media-factory.ts';
import { createUnreportedVideoSourceCharacteristicsV25 } from '../../src/common/editor/video-source-professional-characteristics-v25.ts';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { videoPreviewBenchmarkMedia } from '../browser/fixtures/video-preview-benchmark-media.js';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { installReactTestDom, reactProps } from './react-test-dom.ts';
import { currentReviewedVideoProject, reviewedVideoProjectCustody } from './reviewed-video-project-custody.ts';

type Editor = Awaited<ReturnType<typeof reviewedVideoProjectCustody>>;

/** Real pinned media publication and exact original picture geometry; native image decoding stays in the browser. */
export async function legacyCfrDissolvePictureCustody(context: TestContext, options: Readonly<{
	sampleRate?: number; rows?: readonly (readonly [string, string, string])[]; secondary?: boolean;
}> = {}) {
	const media = videoPreviewBenchmarkMedia;
	assert.equal(createHash('sha256').update(media.file.buffer).digest('hex'), media.sourceSha256);
	const fixture = await reviewedVideoProjectCustody(context, [], { num: 30, den: 1 });
	const sampleRate = options.sampleRate ?? 48_000, secondary = options.secondary ?? false;
	// The original native-archive inputs declare CFR180, without a timing asset.
	// Keep that exact input instead of inventing a180-picture demux result.
	const sourceId = `camera-${crypto.randomUUID()}`;
	const source = createVideoSource({ id: sourceId, storageKey: sourceId, name: 'Camera', mimeType: media.file.mimeType,
		contentSha256: media.sourceSha256, frameRate: { num: 30, den: 1 }, sourceFrameCount: 180,
		sampleRate, sampleFrameCount: sampleRate * 6, width: 1280, height: 720 });
	const rows = options.rows ?? [['pictures', 'first', 'second']];
	const sequenceId = secondary ? 'cut' : 'main';
	const project = createFramescaperProject(PROFILE, { id: `dissolve-${crypto.randomUUID()}`, sampleRate,
		sources: [{ ...source, sampleRate, sampleFrameCount: sampleRate * 6 }],
		clips: rows.flatMap(([, outgoing, incoming], row) => [outgoing, incoming].map((id, index) => ({
			kind: 'video', id, sourceId: source.id, title: `${row === 0 ? 'First' : 'Second'} ${index === 0 ? 'out' : 'in'}`,
			sequenceId, sequenceStartFrame: index * (secondary ? 75 : 30), sequenceFrameCount: secondary ? 75 : 30,
			sourceInFrame: index * (secondary ? 90 : 30), sourceFrameCount: secondary ? 90 : 30, retimeMap: null }))),
		tracks: rows.map(([id, outgoing, incoming]) => ({ id, type: 'video', clipIds: [outgoing, incoming] })),
		sequences: [...(secondary ? [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: [] }] : []),
			{ id: sequenceId, rate: { num: secondary ? 25 : 30, den: 1 }, trackIds: rows.map(([id]) => id) }], primarySequenceId: 'main' });
	const donor = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const archive = await (async () => {
		try {
			await donor.writeMediaAsset(source.storageKey, new Blob([media.file.buffer], { type: media.file.mimeType }), {
				name: media.file.name, mimeType: media.file.mimeType });
			return await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, donor);
		} finally { await donor.close(); }
	})();
	assert.ok(archive.blob);
	await fixture.controller.actions.project.openScapeFile(new File([archive.blob], 'Dissolve.fscape'), () => 'copy');
	assert.equal(fixture.controller.getSnapshot().readOnly, false); assert.equal(fixture.controller.project?.id, project.id);
	const admitted = currentReviewedVideoProject(fixture.controller.project);
	assert.deepEqual(admitted, { ...project, sources: [{ ...project.sources[0], proxyAttachment: null, imageSequence: null,
		characteristics: createUnreportedVideoSourceCharacteristicsV25() }] });
	return { ...fixture, async verifyMedia(value: unknown, store = fixture.environment.store) {
		const current = currentReviewedVideoProject(value); assert.equal(current.sources.length, 1);
		const camera = current.sources[0]; assert.ok(camera?.kind === 'video');
		assert.equal(camera.contentSha256, media.sourceSha256); assert.equal(camera.timingAsset, null);
		assert.deepEqual([camera.sourceFrameCount, camera.sampleRate, camera.sampleFrameCount, camera.width, camera.height],
			[180, sampleRate, sampleRate * 6, 1280, 720]);
		assert.deepEqual(camera.frameRate, { num: 30, den: 1 });
		const blob = await store.loadMediaAsset(camera.storageKey); assert.ok(blob instanceof Blob);
		assert.deepEqual(Buffer.from(await blob.arrayBuffer()), media.file.buffer, 'every original native-archive source byte is retained');
		return current;
	} };
}

export async function assertDissolvePicturePersisted(f: Editor) {
	await f.controller.actions.project.flush();
	const project = await f.verifyMedia(f.controller.project);
	assert.deepEqual(currentReviewedVideoProject(await f.environment.store.loadProject(project.id)), project);
	return project;
}

/** No editing controller/lease is created in this independent archive recipient. */
export async function assertDissolvePictureArchive(context: TestContext, f: Editor) {
	const project = await assertDissolvePicturePersisted(f);
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, f.environment.store); assert.ok(archive.blob);
	const recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await recipient.close(); });
	const imported = await createFramescaperScapeNativeRuntime(PROFILE).importScapeProject(archive.blob, recipient);
	assert.equal(imported.readOnly, false);
	const reopened = await f.verifyMedia(imported.project, recipient);
	assert.deepEqual(reopened, project, 'all authored geometry and real video/timing survive a fresh Scape recipient');
	assert.deepEqual(currentReviewedVideoProject(await recipient.loadProject(project.id)), project);
	return reopened;
}

/** Mount the production dialog on its actual product controller and selected-authoring runtime. */
export async function mountDissolveCustody(context: TestContext, f: Editor, clipId: string) {
	await f.controller.actions.timeline.selectClip(clipId);
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const root = createRoot(dom.container as unknown as Element);
	let pending: Promise<unknown> | null = null;
	context.after(async () => {
		try { await act(async () => { await pending; root.unmount(); }); }
		finally {
			dom.restore(); globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
			else Reflect.deleteProperty(globalThis, 'MutationObserver');
		}
	});
	const render = async () => {
		await f.controller.actions.timeline.selectClip(clipId);
		const project = currentReviewedVideoProject(f.controller.project);
		await act(async () => root.render(<FramescaperSelectedVisualAuthoringDialog surface="video-transition-dissolve"
			controller={f.controller} project={project} selectedClipId={clipId} playheadSample={0}
			editingBlocked={false} readOnly={false} run={operation => {
				pending = Promise.resolve().then(operation); return pending;
			}} onClose={() => undefined} />));
	};
	await render();
	return { dom, render,
		async choosePair(label: string) {
			const select = dom.one('[data-framescaper-authoring-pair]');
			const option = select.querySelectorAll('option').find(option => option.textContent === label); assert.ok(option);
			const value = option.getAttribute('value'); assert.ok(value);
			await act(async () => { reactProps(select).onChange?.({ currentTarget: { value } }); });
			assert.equal(reactProps(select).value, value);
		},
		async seconds(value: '1s' | '44100', samples = false) {
			if (samples) {
				await act(async () => { reactProps(dom.one('.timecode__format-button')).onClick?.(); });
				const item = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent === 'samples'); assert.ok(item);
				await act(async () => { reactProps(item).onClick?.({ stopPropagation() {} }); });
			}
			await act(async () => { reactProps(dom.one('.timecode__display')).onDoubleClick?.({}); });
			const input = dom.one('.timecode').querySelector('input'); assert.ok(input);
			await act(async () => { reactProps(input).onChange?.({ currentTarget: { value } }); });
			await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); });
			assert.equal(reactProps(dom.one('[data-timecode-direct-entry]')).value, 25);
		},
		async perform(operation: 'apply' | 'remove' = 'apply') {
			pending = null;
			await act(async () => {
				reactProps(dom.one(`[data-framescaper-authoring-${operation}]`)).onClick?.();
				await Promise.resolve(); await pending;
			});
			const status = dom.one('[role="status"]'); assert.equal(status.textContent,
				operation === 'apply' ? 'Selected authored state applied.' : 'Selected authored state removed.');
		},
	};
}

export function dissolveDocument(value: unknown) {
	const { revision: _revision, updatedAt: _updatedAt, selection: _selection, ...project } = currentReviewedVideoProject(value);
	return project;
}
