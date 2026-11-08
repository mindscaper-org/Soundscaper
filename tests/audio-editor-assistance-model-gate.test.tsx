/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AssistanceModelGate from '../src/common/editor/ui/dialogs/AssistanceModelGate.tsx';
import AssistanceLoadingDialog from '../src/common/editor/ui/dialogs/AssistanceLoadingDialog.tsx';
import type { LocalModelManagerBridge, LocalModelManagerModel } from
	'../src/common/editor/ui/local-model-manager-bridge.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { localModelManagerStoreFor } from '../src/common/editor/ui/local-model-manager-store.ts';

const MODEL: LocalModelManagerModel = Object.freeze({
	modelId: 'deepfilternet3', version: '3.0.0', task: 'speech-enhancement',
	availability: 'installable', downloadBytes: 4_096, installedBytes: null,
	attributionRequired: false,
});
const filter = (model: LocalModelManagerModel): boolean => model.modelId === MODEL.modelId;

function fixture() {
	let complete: (value: unknown) => void = () => undefined;
	let fail: (value: unknown) => void = () => undefined;
	let lists = 0;
	let nextList: Promise<unknown> | null = null;
	const pending = new Promise<unknown>((resolve, reject) => { complete = resolve; fail = reject; });
	const bridge: LocalModelManagerBridge = {
		listAssistanceModels: () => { lists += 1; return nextList ?? pending; },
		installAssistanceModel: async () => MODEL,
		cancelAssistanceModelInstall: async (modelId) => ({ contractVersion: 1, modelId, outcome: 'not-active' }),
		installPreseededAssistanceModel: async () => null,
		reconcileAssistanceModels: async () => ({ installedModelIds: [], incompleteModelIds: [], rejected: [] }),
		collectAssistanceModelGarbage: async () => ({}),
		listAssistanceModelNotices: async () => [],
		relocateAssistanceModels: async () => ({}),
		removeAssistanceModel: async () => 0,
		onAssistanceInstallProgress: () => () => undefined,
	};
	return { bridge, lists: () => lists, fail,
		holdNextList: () => { nextList = new Promise(() => undefined); },
		complete: (models: readonly LocalModelManagerModel[]) => complete({
			runtimeAvailable: true, runtimeReason: null, models,
		}) };
}

async function mounted(run: (dom: ReturnType<typeof installReactTestDom>,
	root: import('react-dom/client').Root) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const scope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = scope.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	scope.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try { await run(dom, root); }
	finally {
		await act(async () => root.unmount());
		scope.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}

test('effect loading has an accessible indeterminate progress bar and cancellation', () => {
	const markup = renderToStaticMarkup(<AssistanceLoadingDialog title="Enhance Dialogue"
		copy={{}} onClose={() => undefined} />);
	assert.match(markup, /<progress[^>]*aria-label="Loading/u);
	assert.doesNotMatch(markup, /<progress[^>]*value=/u);
	assert.match(markup, />Cancel</u);
});

test('model preflight stays responsive and never mounts processing before the catalog resolves', async () => {
	await mounted(async (dom, root) => {
		const value = fixture();
		let closes = 0;
		await act(async () => root.render(<AssistanceModelGate title="Enhance Dialogue"
			copy={{}} locale="en" bridge={value.bridge} modelFilter={filter} requiresModel
			onClose={() => { closes += 1; }}><p data-processing>Processing runtime</p></AssistanceModelGate>));
		assert.equal(value.lists(), 1);
		assert.ok(dom.find('progress'));
		assert.equal(dom.find('[data-processing]'), null);
		const cancel = dom.one('[data-assistance-loading-cancel]').querySelector('button');
		assert.ok(cancel);
		await act(async () => { reactProps(cancel).onClick(); });
		assert.equal(closes, 1);
	});
});

test('missing models prompt lists related names and sizes before processing mounts', async () => {
	await mounted(async (dom, root) => {
		const value = fixture();
		await act(async () => root.render(<AssistanceModelGate title="Enhance Dialogue"
			copy={{}} locale="en" bridge={value.bridge} modelFilter={filter} requiresModel
			onClose={() => undefined}><p data-processing>Processing runtime</p></AssistanceModelGate>));
		await act(async () => value.complete([MODEL, { ...MODEL, modelId: 'unrelated-model' }]));
		assert.ok(dom.find('[data-assistance-model-prerequisites]'));
		assert.match(dom.container.textContent, /Enhance Dialogue requires a model to be downloaded before it can be executed:/u);
		assert.match(dom.container.textContent, /DeepFilterNet 3.*4 KiB/u);
		assert.doesNotMatch(dom.container.textContent, /unrelated-model/u);
		assert.match(dom.container.textContent, /Cancel.*Open Model Manager.*Download all/u);
		assert.equal(dom.find('[data-processing]'), null);
	});
});

test('an installed related model admits processing after a fresh catalog check', async () => {
	await mounted(async (dom, root) => {
		const value = fixture();
		await act(async () => root.render(<AssistanceModelGate title="Enhance Dialogue"
			copy={{}} locale="en" bridge={value.bridge} modelFilter={filter} requiresModel
			onClose={() => undefined}><p data-processing>Processing runtime</p></AssistanceModelGate>));
		await act(async () => value.complete([{ ...MODEL, availability: 'installed', installedBytes: 4_096 }]));
		assert.ok(dom.find('[data-processing]'));
		assert.equal(dom.find('[data-assistance-model-prerequisites]'), null);
		const processing = dom.one('[data-processing]');
		value.holdNextList();
		await act(async () => {
			void localModelManagerStoreFor(value.bridge).load();
			await Promise.resolve();
		});
		assert.equal(dom.one('[data-processing]'), processing, 'a Model Manager refresh must preserve the admitted dialog');
		assert.equal(dom.find('[data-assistance-loading]'), null);
	});
});

test('model-free tasks open without a model catalog request', async () => {
	await mounted(async (dom, root) => {
		const value = fixture();
		await act(async () => root.render(<AssistanceModelGate title="Mark Cuts"
			copy={{}} locale="en" bridge={value.bridge} modelFilter={filter} requiresModel={false}
			onClose={() => undefined}><p data-processing>Processing runtime</p></AssistanceModelGate>));
		assert.ok(dom.find('[data-processing]'));
		assert.equal(value.lists(), 0);
	});
});

test('a failed catalog remains runtime-free and offers retry', async () => {
	await mounted(async (dom, root) => {
		const value = fixture();
		await act(async () => root.render(<AssistanceModelGate title="Enhance Dialogue"
			copy={{}} locale="en" bridge={value.bridge} modelFilter={filter} requiresModel
			onClose={() => undefined}><p data-processing>Processing runtime</p></AssistanceModelGate>));
		await act(async () => value.fail(new Error('Catalog unavailable')));
		assert.ok(dom.find('[role="alert"]'));
		assert.match(dom.container.textContent, /Retry/u);
		assert.equal(dom.find('[data-processing]'), null);
	});
});

test('a model lost after admission returns to an explicit re-download before resuming processing', async () => {
	await mounted(async (dom, root) => {
		let models: readonly LocalModelManagerModel[] = [{ ...MODEL, availability: 'installed', installedBytes: 4_096 }];
		const installs: string[] = [];
		const removals: string[] = [];
		let recover = (): void => undefined;
		const bridge: LocalModelManagerBridge = { ...fixture().bridge,
			listAssistanceModels: async () => ({ runtimeAvailable: true, runtimeReason: null, models }),
			installAssistanceModel: async modelId => {
				installs.push(modelId);
				models = [{ ...MODEL, availability: 'installed', installedBytes: 4_096 }];
				return models[0];
			},
			removeAssistanceModel: async modelId => { removals.push(modelId); models = [MODEL]; return 0; },
		};
		await act(async () => root.render(<AssistanceModelGate title="Enhance Dialogue"
			copy={{}} locale="en" bridge={bridge} modelFilter={filter} requiresModel onClose={() => undefined}>
			{onModelsMissing => { recover = onModelsMissing; return <p data-processing>Processing runtime</p>; }}
		</AssistanceModelGate>));
		assert.ok(dom.find('[data-processing]'));
		models = [MODEL];
		await act(async () => recover());
		assert.equal(dom.find('[data-processing]'), null);
		assert.ok(dom.find('[data-assistance-model-prerequisites]'));
		assert.deepEqual(installs, []);
		const download = dom.one('[data-assistance-model-prerequisites]').querySelectorAll('button')
			.find(button => button.textContent === 'Re-download');
		assert.ok(download);
		await act(async () => { await reactProps(download).onClick(); });
		assert.deepEqual(installs, [MODEL.modelId]);
		assert.deepEqual(removals, []);
		assert.ok(dom.find('[data-processing]'));
	});
});

test('a stale installed manifest cannot loop back into processing without explicit recovery', async () => {
	await mounted(async (dom, root) => {
		let models: readonly LocalModelManagerModel[] = [{ ...MODEL, availability: 'installed', installedBytes: 4_096 }];
		const calls: string[] = [];
		let recover = (): void => undefined;
		const bridge: LocalModelManagerBridge = { ...fixture().bridge,
			listAssistanceModels: async () => ({ runtimeAvailable: true, runtimeReason: null, models }),
			installAssistanceModel: async modelId => {
				calls.push(`install:${modelId}`);
				models = [{ ...MODEL, availability: 'installed', installedBytes: 4_096 }];
				return models[0];
			},
			removeAssistanceModel: async modelId => { calls.push(`remove:${modelId}`); models = [MODEL]; return 0; },
		};
		await act(async () => root.render(<AssistanceModelGate title="Enhance Dialogue"
			copy={{}} locale="en" bridge={bridge} modelFilter={filter} requiresModel onClose={() => undefined}>
			{onModelsMissing => { recover = onModelsMissing; return <p data-processing>Processing runtime</p>; }}
		</AssistanceModelGate>));
		assert.ok(dom.find('[data-processing]'));
		await act(async () => recover());
		assert.equal(dom.find('[data-processing]'), null);
		assert.deepEqual(calls, []);
		const download = dom.one('[data-assistance-model-prerequisites]').querySelectorAll('button')
			.find(button => button.textContent === 'Re-download');
		assert.ok(download);
		await act(async () => { await reactProps(download).onClick(); });
		assert.deepEqual(calls, [`remove:${MODEL.modelId}`, `install:${MODEL.modelId}`]);
		assert.ok(dom.find('[data-processing]'));
	});
});

test('installing a missing model through the shared Model Manager resumes the pending task', async () => {
	await mounted(async (dom, root) => {
		let models: readonly LocalModelManagerModel[] = [{ ...MODEL, availability: 'installed', installedBytes: 4_096 }];
		let recover = (): void => undefined;
		const bridge: LocalModelManagerBridge = { ...fixture().bridge,
			listAssistanceModels: async () => ({ runtimeAvailable: true, runtimeReason: null, models }),
			installAssistanceModel: async () => {
				models = [{ ...MODEL, availability: 'installed', installedBytes: 4_096 }];
				return models[0];
			},
		};
		await act(async () => root.render(<AssistanceModelGate title="Enhance Dialogue"
			copy={{}} locale="en" bridge={bridge} modelFilter={filter} requiresModel onClose={() => undefined}>
			{onModelsMissing => { recover = onModelsMissing; return <p data-processing>Processing runtime</p>; }}
		</AssistanceModelGate>));
		models = [MODEL];
		await act(async () => recover());
		assert.ok(dom.find('[data-assistance-model-prerequisites]'));
		await act(async () => { await localModelManagerStoreFor(bridge).install(MODEL.modelId); });
		assert.ok(dom.find('[data-processing]'));
		assert.equal(dom.find('[data-assistance-model-prerequisites]'), null);
	});
});
