/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';

import { useLaunchedFileImports, type LaunchedFileImportsInput } from '../src/common/editor/ui/workspace/useLaunchedFileImports.ts';
import { installFileHandlerLaunchConsumer, type FileHandlerLaunchParams } from '../src/common/offline/file-handler-launch.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture, deferred } from './audio-editor-project-import-service-fixture.ts';
import { createProjectImportService } from './helpers/project-import-runtime-fixture.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

function LaunchWorkspace(input: LaunchedFileImportsInput): null { useLaunchedFileImports(input); return null; }

test('separate OS file launches wait for the prior production import instead of losing a file while busy', async () => {
	const fixture = createFixture();
	const gate = deferred<void>();
	const started = deferred<void>();
	const originalDecode = fixture.runtime.engine.decodeAudioData;
	fixture.runtime.engine.decodeAudioData = async () => { started.resolve(); return originalDecode(); };
	fixture.options.decodeGate = gate.promise;
	fixture.runtime.editingBlocked = () => fixture.runtime.state.importing;
	const service = createProjectImportService(fixture.runtime);
	const completed: Promise<unknown>[] = [];
	const errors: unknown[] = [];
	let consumer: ((params: FileHandlerLaunchParams) => void) | undefined;
	const installation = installFileHandlerLaunchConsumer({ desktop: false,
		launchQueue: { setConsumer: handler => { consumer = handler; } }, onError: error => errors.push(error) });
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const bytes = encodeWav([new Float32Array(4)], { sampleRate: 48_000 });
	const launch = (name: string): void => consumer?.({ files: [{ kind: 'file',
		getFile: () => Promise.resolve(new File([bytes], name, { type: 'audio/wav' })) }] });
	try {
		await act(async () => root.render(createElement(LaunchWorkspace, {
			controller: { ready: Promise.resolve() }, claim: () => undefined, collect: () => undefined,
			importFiles: (files: readonly File[]) => { const promise = service.importFiles(files); completed.push(promise); return promise; },
			onError: (error: unknown) => errors.push(error),
		})));
		launch('first.wav');
		await started.promise;
		launch('second.wav');
		await installation.settled();
		await act(async () => { await Promise.resolve(); await Promise.resolve(); });
		gate.resolve();
		await completed[0];
		await act(async () => { await Promise.resolve(); await Promise.resolve(); });
		await Promise.all(completed);
		assert.equal(completed.length, 2);
		assert.equal(fixture.commands.length, 2, 'both launched WAVs must reach source/import publication');
		assert.deepEqual(errors, []);
	} finally {
		gate.resolve();
		await Promise.allSettled(completed);
		await act(async () => root.unmount());
		installation.release();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
