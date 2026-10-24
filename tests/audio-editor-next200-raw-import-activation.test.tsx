/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred } from './helpers/async-test-control.ts';
import React, { act } from 'react';

import { RawPcmImportDialog } from '../src/common/editor/ui/dialogs/ImportAnalysisDialogs.tsx';
import { createFixture, createAudioEditorController, createMemoryEngine, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('returning to the same saved project retires raw PCM preparation from the outgoing activation', async () => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const fixture = await createFixture('next200-raw-activation', { sampleRate: 48_000,
		tracks: [{ id: 'voice', name: 'Voice', input: Float32Array.of(0.25, -0.25) }] });
	const controller = createAudioEditorController(null, { headless: true, store: fixture.store, locale: 'en', copy: ENGLISH_COPY,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready;
	await controller.actions.project.openById(fixture.project.id);
	const initial = controller.project;
	const gate = deferred<ArrayBuffer>();
	const started = deferred<void>();
	class HeldRawFile extends File {
		override slice(start?: number, end?: number, type?: string): Blob {
			const blob = super.slice(start, end, type);
			Object.defineProperty(blob, 'arrayBuffer', { value: () => { started.resolve(); return gate.promise; } });
			return blob;
		}
	}
	const file = new HeldRawFile([new Int16Array([8192, -8192]).buffer], 'outgoing.raw');
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const running: Promise<unknown>[] = [];
	let closes = 0;
	const render = async () => act(async () => root.render(<RawPcmImportDialog controller={controller}
		snapshot={controller.getSnapshot()} copy={ENGLISH_COPY} onClose={() => { closes++; }}
		run={(operation: () => unknown) => {
			const promise = Promise.resolve(operation()); running.push(promise); return promise;
		}} />));
	try {
		await render();
		await act(async () => { reactProps(dom.one('input')).onChange({ currentTarget: { files: [file] } }); });
		await act(async () => {
			reactProps(dom.one('form')).onSubmit({ preventDefault() {} });
			await started.promise;
		});
		const generation = controller.captureProjectGeneration();
		await controller.actions.project.create({ title: 'Incoming OS File Open' });
		await controller.actions.project.openById(fixture.project.id);
		assert.equal(controller.project?.id, initial?.id);
		assert.notEqual(controller.captureProjectGeneration().generation, generation.generation);
		const reopened = controller.project;
		await render();
		await act(async () => {
			gate.resolve(new Int16Array([8192, -8192]).buffer);
			await Promise.all(running);
		});
		assert.equal(controller.project, reopened, 'outgoing PCM must not add a source or clip to the reopened saved document');
		assert.equal(closes, 0, 'an outgoing import must not close the reopened activation\u2019s dialog');
		assert.equal(dom.one('form').getAttribute('aria-busy'), 'false');
	} finally {
		gate.resolve(new Int16Array([8192, -8192]).buffer);
		await act(async () => root.unmount());
		await controller.dispose();
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
