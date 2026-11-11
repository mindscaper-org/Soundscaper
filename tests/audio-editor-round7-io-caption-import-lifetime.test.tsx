/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import type { FramescaperCaptionFileService } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { open } from 'node:fs/promises';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { normalizeVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { framescaperLifetimeController, LifetimeFinishingDialog, lifetimeButton, lifetimeChange } from './helpers/framescaper-lifetime-controller-fixture.tsx';
import { deferred } from './helpers/async-test-control.ts';

for (const mode of ['healthy', 'closed', 'new-project', 'retargeted'] as const) test(`pending caption file belongs to its original dialog and project (${mode})`, async context => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let current = createFramescaperProject(PROFILE, { id: 'original' });
	const original = current;
	let resolveChoice: (value: readonly unknown[]) => void = () => undefined;
	const choosing = new Promise<readonly unknown[]>(resolve => { resolveChoice = resolve; });
	let opened = 0;
	let released = 0;
	let commits = 0;
	const controller = { actions: { edit: { commit(command: unknown) {
		commits += 1;
		current = applyFramescaperProjectCommand(PROFILE, current, command);
	} } } };
	const fileService: FramescaperCaptionFileService = {
		isDesktop: true, chooseFiles: () => choosing,
		async withReadDescriptors(_descriptors, _options, consume) {
			opened += 1;
			try {
				return await consume([new File(['1\n00:00:00,100 --> 00:00:00,500\nOriginal dialogue\n\n'], 'dialogue.srt')]);
			} finally { released += 1; }
		},
	};
	const render = () => root.render(<FramescaperFinishingDialog surface="captions"
		controller={controller} project={current} editingBlocked={false} readOnly={false}
		fileService={fileService} run={operation => operation()} onClose={() => root.unmount()} />);
	try {
		await act(async () => { render(); });
		const button = dom.container.querySelectorAll('button').find(node => node.textContent === 'Choose sidecar file');
		assert.ok(button);
		await act(async () => { void reactProps(button).onClick({}); });
		if (mode === 'closed' || mode === 'new-project') {
			const close = dom.container.querySelectorAll('button').find(node => node.getAttribute('aria-label') === 'Close');
			assert.ok(close);
			await act(async () => { void reactProps(close).onClick({}); });
		}
		if (mode === 'new-project' || mode === 'retargeted') {
			current = createFramescaperProject(PROFILE, { id: 'new-project' });
			assert.equal(current.primarySequenceId, original.primarySequenceId);
			if (mode === 'retargeted') await act(async () => { render(); });
		}
		await act(async () => {
			resolveChoice([{ id: 'selected-caption' }]);
			await new Promise<void>(resolve => { setImmediate(resolve); });
		});
		assert.equal(opened, 1, 'the selected sidecar has completed its ordinary scoped read');
		assert.equal(released, 1, 'cancelled publication still releases the selected read scope');
		assert.equal(commits, mode === 'healthy' ? 1 : 0);
		assert.equal((current.videoCaptionTracks as readonly unknown[]).length, mode === 'healthy' ? 1 : 0);
	} finally {
		resolveChoice([]);
		await act(async () => { root.unmount(); });
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
	if (mode === 'new-project') await actualCaptionLifetime(context);
});

async function actualCaptionLifetime(context: test.TestContext): Promise<void> {
	const reading = deferred<void>(), started = deferred<void>();
	const text = '1\n00:00:00,100 --> 00:00:00,500\nOriginal dialogue\n\n';
	const native = await nativeSidecarFixture('dialogue.srt', text, {
		async openSelectedFile(...args) { started.resolve(); await reading.promise; return open(...args); },
	});
	const fixture = mountControllerDataDom();
	try {
		const { controller, persisted } = await framescaperLifetimeController(context);
		const fileService = createAudioEditorFileService({ bridge: native.bridge, fetch: native.fetch });
		const render = (key: string) => fixture.render(<LifetimeFinishingDialog key={key} surface="captions"
			controller={controller} fixture={fixture} fileService={fileService} />);
		const click = async (label: string) => { await act(async () => { reactProps(lifetimeButton(fixture.dom.container, label)).onClick({}); }); };
		await render('original');
		await click('Choose sidecar file');
		await started.promise;
		assert.equal(reactProps(lifetimeButton(fixture.dom.container, 'Choose sidecar file')).disabled, true);
		const outgoing = await persisted();
		await click('Close');
		await act(async () => { await controller.actions.project.create({}); });
		assert.notEqual(controller.project?.id, outgoing.id);
		await render('replacement');
		assert.equal(Boolean(reactProps(lifetimeButton(fixture.dom.container, 'Choose sidecar file')).disabled), false);
		const before = await persisted(), history = structuredClone(controller.getSnapshot().history);
		await act(async () => { reading.resolve(); await fixture.settle(); });
		assert.equal(native.releases.length, 1, 'real host capability is retired after the complete caption consumer');
		assert.deepEqual(await persisted(), before, 'late physical caption cannot mutate the replacement repository');
		assert.deepEqual(controller.getSnapshot().history, history);
		await act(async () => {
			lifetimeChange(fixture.dom.container, 'Track ID', 'new-captions');
			lifetimeChange(fixture.dom.container, 'Sidecar text', text.replace('Original dialogue', 'New dialogue'));
		});
		await click('Import sidecar text');
		await act(async () => { await fixture.settle(); });
		const project = await persisted();
		assert.ok(Array.isArray(project.videoCaptionTracks)); assert.equal(project.videoCaptionTracks.length, 1);
		const track = normalizeVideoCaptionTrackV1(project.videoCaptionTracks[0]);
		assert.equal(track.sequenceId, project.primarySequenceId);
		assert.deepEqual(track.cues.map(({ startFrame, endFrame, text }) => ({ startFrame, endFrame, text })), [
			{ startFrame: 4_800, endFrame: 24_000, text: 'New dialogue' },
		]);
		assert.equal(track.id, 'new-captions');
		assert.match(fixture.dom.container.textContent, /No interchange losses\./u);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history.undoEntries.length + 1);
		await act(async () => { controller.actions.edit.undo(); });
		assert.deepEqual((await persisted()).videoCaptionTracks, []);
		await act(async () => { controller.actions.edit.redo(); });
		assert.deepEqual((await persisted()).videoCaptionTracks, project.videoCaptionTracks);
	} finally { reading.resolve(); try { await fixture.dispose(); } finally { await native.close(); } }
}
