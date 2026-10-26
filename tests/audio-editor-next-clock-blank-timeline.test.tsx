/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TelemetryTimeCode from '../src/common/editor/ui/toolbar/TelemetryTimeCode.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const sampleRate of [44_100, 48_000]) test(`the playhead clock can seek into the blank ${sampleRate}Hz timeline`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection(), engine = createMemoryEngine();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: engine as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'blank-clock', sampleRate }));
	await controller.actions.transport.seek(sampleRate * 5);
	assert.equal(engine.getPositionFrames(), sampleRate * 5, 'the actual transport admits the blank timeline');
	await controller.actions.transport.seek(0);
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const beforeReact = globals.React, beforeAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	context.after(async () => { await act(async () => root.unmount()); dom.restore(); globals.React = beforeReact; globals.IS_REACT_ACT_ENVIRONMENT = beforeAct; });
	let pending: unknown;
	await act(async () => root.render(<TelemetryTimeCode controller={controller} copy={ENGLISH_COPY}
		project={controller.project} durationFrames={0} run={operation => { pending = operation(); return pending; }} />));
	await act(async () => reactProps(dom.one('.timecode__display')).onDoubleClick?.({}));
	const input = dom.one('input');
	await act(async () => reactProps(input).onChange?.({ currentTarget: { value: '5' } }));
	await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); await pending; });
	assert.equal(engine.getPositionFrames(), sampleRate * 5, 'precise time entry must reach the same position as the ruler and transport');
});
