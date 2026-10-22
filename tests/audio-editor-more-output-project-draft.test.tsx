/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import { OutputTrackDock } from '../src/common/editor/ui/timeline/OutputTrackRows.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

test('MP46: an unfinished group-bus rename cannot rename a matching bus after project activation', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const select = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await act(async () => root.unmount()); await controller.dispose();
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
		if (select) Object.defineProperty(ReactTestElement.prototype, 'select', select); else Reflect.deleteProperty(ReactTestElement.prototype, 'select'); });
	await controller.ready; await controller.actions.project.open(createSoundscaperProject({ id: 'first' }));
	const busId = controller.actions.mixer.addBus('group'); assert.equal(typeof busId, 'string');
	const original = controller.project; assert.ok(original);
	const render = async () => {
		const bus = normalizeMixerGraphV21(controller.project?.mixer).groups[0]; assert.ok(bus);
		await act(async () => root.render(<ThemeProvider><OutputTrackDock controller={controller}
			rows={[{ key: `group:${bus.id}`, scope: 'group', bus: { ...bus, envelope: [] } }]}
			focusedOutputKey={`group:${bus.id}`} onFocusOutput={() => undefined} onMenu={() => undefined}
			panelWidth={240} verticalRulerWidth={20} viewportWidth={600} timelineWidth={600} scrollX={0}
			pixelsPerSecond={100} sampleRate={48_000} rulerScale={undefined} mappedTicks={[]} durationFrames={48_000}
			selection={null} height={150} automationToolEnabled={false} stripEnvelopeAvailable={false}
			blocked={false} mobile={false} copy={{ master: 'Master', output: 'Output', trackName: 'Track name' }}
			run={(work: () => unknown) => work()} onOpenEffects={() => undefined} /></ThemeProvider>));
	};
	await render();
	await act(async () => { const name = dom.one('.track-control-panel__track-name-text');
		reactProps(dom.one('[data-output-track-header]')).onDoubleClick({ target: name }); });
	const input = dom.one('input');
	await act(async () => { reactProps(input).onChange({ currentTarget: { value: 'Old project group draft' }, target: { value: 'Old project group draft' } }); });
	await controller.actions.project.rename('Keep draft during own project edit'); await render();
	assert.equal(dom.one('input').value, 'Old project group draft');
	await controller.actions.project.open({ ...original, id: 'second' }); await render();
	const current = dom.find('input');
	if (current) await act(async () => { reactProps(dom.one('.audio-editor-output-name-editor')).onBlur(); });
	assert.equal(normalizeMixerGraphV21(controller.project?.mixer).groups[0]?.name,
		normalizeMixerGraphV21(original.mixer).groups[0]?.name);
});
