/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import React, { act } from 'react';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import type { FramescaperCaptionFileService } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { bindFramescaperCubeLutActionsFinishing, createFramescaperCubeLutActionsFinishing } from '../src/framescaper/editor-cube-lut-actions-finishing.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createFramescaperVisualInspectorCommand, createFramescaperVisualInspectorModel } from '../src/common/editor/ui/framescaper-visual-inspector-model.ts';
import { normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { normalizeVideoVisualPresentationV1 } from '../src/common/editor/video-visual-presentation-v27.ts';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { framescaperLifetimeController, LifetimeFinishingDialog, lifetimeButton } from './helpers/framescaper-lifetime-controller-fixture.tsx';
import { deferred } from './helpers/async-test-control.ts';

const LUT = ['TITLE "Identity"', 'LUT_3D_SIZE 2', '0 0 0', '1 0 0', '0 1 0', '1 1 0',
	'0 0 1', '1 0 1', '0 1 1', '1 1 1', ''].join('\n');

for (const phase of ['choice', 'read', 'metadata'] as const) {
for (const closed of [false, true]) test(`pending LUT ${phase} ${closed ? 'is retired by Close' : 'publishes for its original open dialog'}`, { timeout: 5000 }, async context => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let current = createFramescaperProject(PROFILE, { id: 'original', finishing: { finishingPresets: [{
		schemaVersion: 1, kind: 'video-finishing-preset', id: 'identity-preset', name: 'Identity',
		template: { enabled: true, opacity: 1, blendMode: 'normal', grade: null },
	}] } });
	let resume!: () => void;
	let entered!: () => void;
	const pending = new Promise<void>(resolve => { resume = resolve; });
	const waiting = new Promise<void>(resolve => { entered = resolve; });
	let commits = 0;
	let releases = 0;
	let bodies = 0;
	const controller = { get project() { return current; }, actions: { edit: { commit(command: unknown) {
		commits += 1;
		current = applyFramescaperProjectCommand(PROFILE, current, command);
	} } } };
	bindFramescaperCubeLutActionsFinishing(controller, createFramescaperCubeLutActionsFinishing({ owner: controller,
		store: { async getMediaAssetMetadata() {
			if (phase === 'metadata') { entered(); await pending; }
			return null;
		}, async writeMediaAsset() { bodies += 1; }, async deleteMediaAsset() { bodies -= 1; } },
	}));
	const fileService: FramescaperCaptionFileService = {
		isDesktop: true,
		async chooseFiles() { if (phase === 'choice') { entered(); await pending; } return [{ id: 'selected-lut' }]; },
		async withReadDescriptors(_descriptors, _options, consume) {
			try {
				if (phase === 'read') { entered(); await pending; }
				return await consume([new File([LUT], 'identity.cube', { type: 'text/plain' })]);
			} finally { releases += 1; }
		},
	};
	try {
		await act(async () => root.render(<FramescaperFinishingDialog surface="grading-presets"
			controller={controller} project={current} editingBlocked={false} readOnly={false}
			fileService={fileService} run={operation => operation()} onClose={() => root.unmount()} />));
		const choose = dom.container.querySelectorAll('button').find(node => node.textContent === 'Choose .cube LUT');
		assert.ok(choose);
		await act(async () => { void reactProps(choose).onClick({}); await setImmediate(); });
		await waiting;
		if (closed) {
			const close = dom.container.querySelectorAll('button').find(node => node.getAttribute('aria-label') === 'Close');
			assert.ok(close);
			await act(async () => { void reactProps(close).onClick({}); });
		}
		await act(async () => { resume(); await setImmediate(); });
		assert.equal(releases, 1, 'the scoped selected descriptor is released after its complete consumer');
		assert.equal(commits, closed ? 0 : 1);
		assert.equal(bodies, closed ? 0 : 1);
		const presets = current.videoFinishingPresets as readonly Readonly<{ template: Readonly<{ grade: unknown }> }>[];
		assert.equal(presets[0]?.template.grade != null, !closed);
	} finally {
		resume(); await act(async () => root.unmount());
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
	if (phase === 'read' && closed) await actualLutLifetime(context);
});
}

async function actualLutLifetime(context: test.TestContext): Promise<void> {
	const reading = deferred<void>(), started = deferred<void>();
	const native = await nativeSidecarFixture('identity.cube', LUT, {
		async openSelectedFile(...args) { started.resolve(); await reading.promise; return open(...args); },
	});
	const fixture = mountControllerDataDom();
	const failures: unknown[] = [];
	const observedFixture = { ...fixture, run(operation: () => unknown): Promise<unknown> {
		const pending = Promise.resolve().then(operation);
		// Observe settlement for cleanup while returning the original rejection to the real dialog.
		void fixture.run(() => pending.catch((error: unknown) => { failures.push(error); }));
		return pending;
	} };
	try {
		const { controller, environment, persisted } = await framescaperLifetimeController(context);
		const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller); assert.ok(authoring);
		await authoring.run('video-solid');
		const clip = normalizeVideoGeneratorClipV1(controller.project?.clips.at(-1));
		const inspector = createFramescaperVisualInspectorModel({ project: controller.project, selectedClipId: clip.id });
		controller.actions.edit.commit(createFramescaperVisualInspectorCommand(controller.project, clip.id, {
			generator: inspector.generator, opacity: .5, blendMode: inspector.blendMode,
			maskId: inspector.maskId, maskWidth: inspector.maskWidth, presetId: null,
		}));
		const before = await persisted(), history = structuredClone(controller.getSnapshot().history);
		assert.ok(Array.isArray(before.videoVisualPresentations)); assert.equal(before.videoVisualPresentations.length, 1);
		assert.equal(normalizeVideoVisualPresentationV1(before.videoVisualPresentations[0]).opacity, .5);
		const fileService = createAudioEditorFileService({ bridge: native.bridge, fetch: native.fetch });
		await fixture.render(<LifetimeFinishingDialog surface="grading-presets" controller={controller}
			fixture={observedFixture} fileService={fileService} />);
		const target = fixture.dom.container.querySelector('select'); assert.ok(target);
		assert.match(String(reactProps(target).value), /^presentation:/u);
		await act(async () => { reactProps(lifetimeButton(fixture.dom.container, 'Choose .cube LUT')).onClick({}); });
		await started.promise;
		assert.equal(reactProps(lifetimeButton(fixture.dom.container, 'Choose .cube LUT')).disabled, true);
		await act(async () => { reactProps(lifetimeButton(fixture.dom.container, 'Close')).onClick({}); });
		await act(async () => { reading.resolve(); await fixture.settle(); });
		assert.equal(native.releases.length, 1);
		const project = await persisted(), sha256 = createHash('sha256').update(LUT).digest('hex');
		assert.ok(Array.isArray(project.videoVisualPresentations)); assert.equal(project.videoVisualPresentations.length, 1);
		const presentation = normalizeVideoVisualPresentationV1(project.videoVisualPresentations[0]);
		assert.equal(presentation.opacity, .5);
		assert.equal(presentation.grade?.lut != null, false);
		const storageKey = `lut-sha256:${sha256}`;
		assert.deepEqual(project, before, 'closed actual target cannot publish a LUT or repository edit');
		assert.deepEqual(controller.getSnapshot().history, history);
		assert.equal(await environment.store.getMediaAssetMetadata(storageKey), null);
		assert.equal(failures.length, 1);
		assert.ok(failures[0] instanceof DOMException); assert.equal(failures[0].name, 'AbortError');
	} finally { reading.resolve(); try { await fixture.dispose(); } finally { await native.close(); } }
}
