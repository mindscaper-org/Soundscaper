/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VideoKeyframeDialog from '../src/common/editor/ui/inspector/VideoKeyframeDialog.tsx';
import { createVideoKeyframeCurve, createVideoKeyframeDialogModel, createVideoKeyframeSetCommand,
	videoKeyframeTargetKey } from '../src/common/editor/ui/video-keyframe-dialog-model.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

type Parameter = 'opacity' | 'transform.scaleX';
const targetKey = (parameterId: Parameter) => videoKeyframeTargetKey({ kind: 'composition', parameterId });

async function fixture(seeded = true) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT, priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true; Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let project = createFramescaperProject(PROFILE, framescaperV20Options());
	const original = project;
	const model = () => createVideoKeyframeDialogModel({ productId: 'framescaper', capability: true, project,
		snapshot: { selectedClipId: 'video-clip' } });
	if (seeded) project = applyFramescaperProjectCommand(PROFILE, project, createVideoKeyframeSetCommand(model(),
		createVideoKeyframeCurve(model(), { target: { kind: 'composition', parameterId: 'transform.scaleX' },
			start: { position: { num: 0, den: 1 }, value: 1 }, end: { position: { num: 10, den: 1 }, value: 1.2 }, segment: { kind: 'linear' } })));
	const seededProject = project;
	const root = createRoot(dom.container as unknown as Element);
	const commands: unknown[] = [];
	let gate: ReturnType<typeof deferred<void>> | null = null;
	const controller = { get project() { return project; }, actions: { edit: { commit(command: unknown): Promise<void> | undefined {
		commands.push(command); project = applyFramescaperProjectCommand(PROFILE, project, command); render();
		return gate?.promise;
	} } } };
	const render = (): void => root.render(<VideoKeyframeDialog productId="framescaper" capability controller={controller}
		snapshot={{ project, selectedClipId: 'video-clip' }} copy={ENGLISH_COPY} run={work => work()} onClose={() => undefined} />);
	const button = (label: string) => { const node = dom.container.querySelectorAll('button').find(item => item.textContent === label); assert.ok(node, label); return node; };
	const form = () => { const node = button('Add curve').closest('form'); assert.ok(node); return node; };
	await act(async () => render());
	return { dom, commands, model, button,
		target: () => dom.one('[data-video-keyframe-field="target"]'),
		select: async (id: Parameter) => act(async () => { reactProps(dom.one('[data-video-keyframe-field="target"]')).onChange({ currentTarget: { value: targetKey(id) } }); }),
		submit: async () => act(async () => { const node = form(); reactProps(node).onSubmit({ preventDefault() {}, currentTarget: node }); }),
		click: async (label: string) => act(async () => {
			const node = button(label), props = reactProps(node);
			if (typeof props.onClick === 'function') props.onClick({ currentTarget: node, detail: 1 });
			else { const owner = node.closest('form'); assert.ok(owner); reactProps(owner).onSubmit({ preventDefault() {}, currentTarget: owner }); }
		}),
		field: async (hook: string, value: string) => act(async () => { reactProps(dom.one(`[data-video-keyframe-field="${hook}"]`)).onChange({ currentTarget: { value } }); }),
		hold() { gate = deferred<void>(); },
		release: async () => act(async () => { gate?.resolve(); gate = null; }),
		restore: async (existing: boolean) => act(async () => { project = existing ? seededProject : original; render(); }),
		dispose: async () => { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore(); },
	};
}

test('a reopened authored target disables Add while preserving its edit and transfer controls', async () => {
	const f = await fixture();
	try {
		assert.equal(reactProps(f.target()).value, targetKey('transform.scaleX'));
		assert.equal(f.button('Add curve').hasAttribute('disabled'), true);
		assert.equal(f.target().hasAttribute('disabled'), false);
		assert.equal(f.button('Paste curve').hasAttribute('disabled'), false);
		assert.equal(f.button('Update anchor').hasAttribute('disabled'), false);
		await f.submit(); assert.deepEqual(f.commands, [], 'the form callback also declines duplicate Add');
		assert.equal(f.dom.container.querySelector('[role="alert"]'), null);
	} finally { await f.dispose(); }
});

test('an unauthored target adds a real curve and then becomes ineligible for duplicate Add', async () => {
	const f = await fixture();
	try {
		await f.select('opacity'); assert.equal(f.button('Add curve').hasAttribute('disabled'), false);
		await f.field('start-value', '.25'); await f.field('end-value', '.75'); await f.submit();
		assert.equal(f.commands.length, 1);
		assert.deepEqual(f.model().keyframes?.curves.find(curve => videoKeyframeTargetKey(curve.target) === targetKey('opacity'))?.curve.anchors.map(anchor => anchor.value), [.25, .75]);
		assert.equal(reactProps(f.target()).value, targetKey('opacity'), 'Paste keeps the deliberately selected destination');
		assert.equal(f.button('Add curve').hasAttribute('disabled'), true);
	} finally { await f.dispose(); }
});

test('removal and authoritative restoration reconcile Add eligibility without disabling editing', async () => {
	const f = await fixture();
	try {
		await f.click('Remove curve'); assert.equal(f.button('Add curve').hasAttribute('disabled'), false);
		await f.restore(true); assert.equal(f.button('Add curve').hasAttribute('disabled'), true);
		await f.field('anchor-value', '1.5'); await f.click('Update anchor');
		assert.equal(f.model().keyframes?.curves[0]?.curve.anchors[0]?.value, 1.5);
		await f.restore(false); assert.equal(f.button('Add curve').hasAttribute('disabled'), false);
	} finally { await f.dispose(); }
});

for (const moveFocus of [false, true]) test(`completed Add ${moveFocus ? 'respects later input focus' : 'hands focus to Target after permanently disabling its submitter'}`, async () => {
	const f = await fixture(false);
	try {
		await f.select('transform.scaleX'); f.hold(); f.button('Add curve').focus(); await f.submit();
		const other = f.dom.one('[data-video-keyframe-field="end-value"]');
		if (moveFocus) other.focus(); else document.body.focus();
		await f.release();
		assert.strictEqual(document.activeElement, moveFocus ? other : f.target());
	} finally { await f.dispose(); }
});
