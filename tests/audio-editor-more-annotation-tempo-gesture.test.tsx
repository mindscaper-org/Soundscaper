/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TimelineAnnotationLayer } from '../src/common/editor/ui/timeline/TimelineAnnotationLayer.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

async function fixture(context: TestContext, region = false, peerBeat = { num: 1, den: 2 }) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const scheduled = new Map<number, FrameRequestCallback>(); let frameId = 0;
	globalThis.requestAnimationFrame = callback => { scheduled.set(++frameId, callback); return frameId; };
	globalThis.cancelAnimationFrame = id => { scheduled.delete(id); };
	const root = createRoot(dom.container as unknown as Element);
	const common = { sequenceId: 'main', name: 'Move', color: 'auto', batchId: null, opaqueExtensions: {} };
	const project = createSoundscaperProject({ id: 'annotation-tempo-gesture', sampleRate: 48_000,
		sequences: [{ id: 'main', trackIds: [] }], primarySequenceId: 'main',
		tempoMap: { mode: 'musical', events: [
			{ id: 'slow', beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
			{ id: 'fast', beat: { num: 4, den: 1 }, bpm: { num: 240, den: 1 } },
		] },
		timelineAnnotations: region ? [{ ...common, id: 'primary', kind: 'region', anchor: 'musical',
			startBeat: { num: 1, den: 1 }, endBeat: { num: 2, den: 1 } }] : [
			{ ...common, id: 'primary', kind: 'marker', anchor: 'sample', positionFrame: 240_000 },
			{ ...common, id: 'peer', kind: 'marker', anchor: 'musical', positionBeat: peerBeat },
		], selection: { startFrame: 0, endFrame: 240_000, trackIds: [], clipIds: [], annotationIds: region ? ['primary'] : ['primary', 'peer'] },
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	await store.saveProject(project);
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await act(async () => root.unmount()); await controller.dispose(); dom.restore();
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct; });
	await controller.ready; await controller.actions.project.openById(project.id);
	const render = async () => await act(async () => {
		const snapshot = controller.getSnapshot(); assert.ok(snapshot.project);
		root.render(<TimelineAnnotationLayer controller={controller} project={snapshot.project} annotations={snapshot.timelineAnnotations}
			selectedAnnotationId="primary" copy={ENGLISH_COPY} locale="en" pixelsPerSecond={100} sampleRate={48_000}
			scrollX={0} viewportWidth={1000} blocked={false} run={(operation: () => unknown) => operation()} createAnnotation={() => undefined} />);
	});
	await render();
	const item = () => dom.one('[data-annotation-id="primary"]');
	const event = (clientX: number) => ({ pointerId: 1, button: 0, buttons: 1, isPrimary: true, pointerType: 'mouse', clientX,
		target: item(), currentTarget: item(), shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} });
	return { controller, dom, render, item, event, flush: () => { const callbacks = [...scheduled.values()]; scheduled.clear(); for (const callback of callbacks) callback(0); } };
}

test('MI28: dragging a mixed-anchor marker group clamps before a musical peer would pass beat zero', async context => {
	const f = await fixture(context);
	await act(async () => { reactProps(f.item()).onPointerDown(f.event(512)); reactProps(f.item()).onPointerMove(f.event(462)); });
	await act(async () => { f.flush(); });
	const previewLeft: unknown = Reflect.get(f.item().style, 'left');
	await act(async () => { reactProps(f.item()).onPointerUp(f.event(462)); });
	const primary = f.controller.project?.timelineAnnotations.find(value => value.id === 'primary');
	const peer = f.controller.project?.timelineAnnotations.find(value => value.id === 'peer');
	assert.ok(primary?.kind === 'marker' && primary.anchor === 'sample');
	assert.ok(peer?.kind === 'marker' && peer.anchor === 'musical');
	assert.equal(primary.positionFrame, 234_000, 'the largest legal shared move is one eighth second at the primary clock');
	assert.deepEqual(peer.positionBeat, { num: 0, den: 1 });
	assert.equal(previewLeft, '499.5px', 'the legal pointer preview matches the exact native commit');
	await f.render(); assert.equal(Reflect.get(f.item().style, 'left'), previewLeft);
});

test('MI28: a dragged musical region previews its beat-preserving duration across a tempo change', async context => {
	const f = await fixture(context, true);
	await act(async () => { reactProps(f.item()).onPointerDown(f.event(162)); reactProps(f.item()).onPointerMove(f.event(562)); });
	await act(async () => { f.flush(); });
	const previewWidth: unknown = Reflect.get(f.item().style, 'width');
	await act(async () => { reactProps(f.item()).onPointerUp(f.event(562)); }); await f.render();
	assert.equal(previewWidth, '25px', 'one beat lasts a quarter second at the destination tempo');
	assert.equal(Reflect.get(f.item().style, 'width'), previewWidth, 'releasing a drag must retain the shown exact beat span');
});

test('MI28: modified-arrow marker moves obey the same musical lower bound and remain undoable', async context => {
	const f = await fixture(context);
	await act(async () => { reactProps(f.item()).onKeyDown({ key: 'ArrowLeft', ctrlKey: true, metaKey: false,
		altKey: false, shiftKey: false, defaultPrevented: false, preventDefault() {}, stopPropagation() {} }); });
	const moved = f.controller.getSnapshot().timelineAnnotations.find(value => value.id === 'primary');
	assert.equal(moved?.timelineStartFrame, 234_000);
	f.controller.actions.edit.undo();
	assert.equal(f.controller.getSnapshot().timelineAnnotations.find(value => value.id === 'primary')?.timelineStartFrame, 240_000);
});

test('MI28: fractional-sample musical bounds round inward before native gesture publication', async context => {
	const f = await fixture(context, false, { num: 1, den: 7 });
	await act(async () => { reactProps(f.item()).onPointerDown(f.event(512)); reactProps(f.item()).onPointerMove(f.event(462)); });
	await act(async () => { reactProps(f.item()).onPointerUp(f.event(462)); });
	const primary = f.controller.project?.timelineAnnotations.find(value => value.id === 'primary');
	const peer = f.controller.project?.timelineAnnotations.find(value => value.id === 'peer');
	assert.ok(primary?.kind === 'marker' && primary.anchor === 'sample');
	assert.ok(peer?.kind === 'marker' && peer.anchor === 'musical');
	assert.equal(primary.positionFrame, 238_286);
	assert.deepEqual(peer.positionBeat, { num: 1, den: 42_000 });
});
