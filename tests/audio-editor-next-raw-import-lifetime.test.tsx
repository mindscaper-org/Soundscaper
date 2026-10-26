/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { RawPcmImportDialog } from '../src/common/editor/ui/dialogs/ImportAnalysisDialogs.tsx';
import { createFixture, createAudioEditorController, createMemoryEngine, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { deferred } from './helpers/async-test-control.ts';

test('File New retires the outgoing raw conversion without waiting or clearing a newer import', async () => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const fixture = await createFixture('next-raw-owner', { sampleRate: 44_100,
		tracks: [{ id: 'voice', name: 'Voice', input: new Float32Array(80) }] });
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en',
		store: fixture.store, engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready;
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const oldRead = delayedRaw('old-project.raw');
	const newRead = delayedRaw('new-project.raw');
	const running: Promise<unknown>[] = [];
	let closes = 0;
	const render = async () => {
		await act(async () => root.render(<RawPcmImportDialog controller={controller}
			snapshot={controller.getSnapshot()} copy={ENGLISH_COPY}
			run={operation => { const result = Promise.resolve(operation()); running.push(result); return result; }}
			onClose={() => { closes += 1; }} />));
	};
	const choose = async (file: File) => {
		await act(async () => reactProps(dom.one('input')).onChange({ currentTarget: { files: [file] } }));
	};
	const submit = async (started: Promise<void>) => {
		await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); await started; });
	};
	try {
		await render();
		await choose(oldRead.file);
		await submit(oldRead.started.promise);
		const originalId = controller.project?.id;
		await controller.actions.project.create({ title: 'New workspace during raw file read' });
		assert.notEqual(controller.project?.id, originalId);
		const newProjectId = controller.project?.id;
		await render();
		assert.equal(dom.one('form').getAttribute('aria-busy'), 'false', 'the new project must not wait for the old file read');
		await choose(newRead.file);
		await submit(newRead.started.promise);
		assert.equal(running.length, 2);
		await act(async () => { oldRead.read.resolve(new ArrayBuffer(2)); await running[0]; });
		assert.equal(dom.one('form').getAttribute('aria-busy'), 'true', 'old completion cannot unlock the new conversion');
		assert.equal(closes, 0);
		await act(async () => { newRead.read.resolve(new ArrayBuffer(2)); await running[1]; });
		assert.equal(controller.project?.id, newProjectId);
		assert.deepEqual(controller.project?.sources.map(source => source.name), ['new-project.wav']);
		assert.equal(closes, 1);
		assert.equal(dom.one('form').getAttribute('aria-busy'), 'false');
	} finally {
		oldRead.read.resolve(new ArrayBuffer(2));
		newRead.read.resolve(new ArrayBuffer(2));
		await act(async () => { await Promise.allSettled(running); root.unmount(); });
		await controller.dispose();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function delayedRaw(name: string) {
	const read = deferred<ArrayBuffer>();
	const started = deferred<void>();
	const file = new File([new Uint8Array(2)], name);
	Object.defineProperty(file, 'slice', { value: () => ({ arrayBuffer: () => {
		started.resolve();
		return read.promise;
	} }) });
	return { file, read, started };
}
