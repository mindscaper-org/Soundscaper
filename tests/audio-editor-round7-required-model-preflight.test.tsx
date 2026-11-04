/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

import LocalAssistanceDialogSurface from '../src/common/editor/ui/dialogs/LocalAssistanceDialogSurface.tsx';
import type { LocalModelManagerBridge, LocalModelManagerModel } from
	'../src/common/editor/ui/local-model-manager-bridge.ts';
import type { AssistanceGuidedWorkflowId } from '../src/common/editor/assistance/workflow-recipes.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { rawBridgeFixture } from './helpers/local-assistance-fixtures.ts';
import { localModelManagerStoreFor } from '../src/common/editor/ui/local-model-manager-store.ts';

function model(modelId: string, version: string, task: string,
	availability: LocalModelManagerModel['availability']): LocalModelManagerModel {
	return { modelId, version, task, availability, downloadBytes: 4096,
		installedBytes: availability === 'installed' ? 4096 : null, attributionRequired: false };
}

const SILERO = model('silero-vad-v6', '6.2.1', 'voice-activity-detection', 'installed');
const PARAKEET = model('parakeet-tdt-0.6b-v3', '3.0.0', 'speech-recognition', 'installable');
const WHISPER = model('whisper-large-v3-turbo-ggml', '1.0.0', 'speech-recognition', 'installed');
const ALIGNMENT = model('wav2vec2-base-960h', '1.0.0', 'word-alignment', 'installable');

async function mounted(workflowId: AssistanceGuidedWorkflowId,
	initialModels: readonly LocalModelManagerModel[], run: (
		dom: ReturnType<typeof installReactTestDom>, installs: readonly string[], removals: readonly string[],
		bridge: LocalModelManagerBridge,
	) => Promise<void>, loseRecognizer = false, lostRecognizerId = PARAKEET.modelId,
	loseAfterConfiguration = false): Promise<void> {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const scope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = scope.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	scope.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let models = [...initialModels];
	const installs: string[] = [];
	const removals: string[] = [];
	const bridge: LocalModelManagerBridge = {
		listAssistanceModels: async () => ({ runtimeAvailable: true, runtimeReason: null, models }),
		installAssistanceModel: async (modelId) => {
			installs.push(modelId);
			models = models.map(value => value.modelId === modelId
				? { ...value, availability: 'installed', installedBytes: 4096 } : value);
			return models.find(value => value.modelId === modelId);
		},
		cancelAssistanceModelInstall: async modelId => ({ contractVersion: 1, modelId, outcome: 'not-active' }),
		installPreseededAssistanceModel: async () => null,
		reconcileAssistanceModels: async () => ({ installedModelIds: [], incompleteModelIds: [], rejected: [] }),
		collectAssistanceModelGarbage: async () => ({}), listAssistanceModelNotices: async () => [],
		relocateAssistanceModels: async () => ({}), removeAssistanceModel: async modelId => {
			removals.push(modelId);
			models = models.map(value => value.modelId === modelId
				? { ...value, availability: 'installable', installedBytes: null } : value);
			return 0;
		},
		onAssistanceInstallProgress: () => () => undefined,
	};
	const unused = async (): Promise<never> => { throw new Error('This preflight test never runs inference.'); };
	let loseModel = loseRecognizer;
	let modelReads = 0;
	const runtime = loseRecognizer ? { ...rawBridgeFixture().api,
		models: async () => {
			if (loseModel && (!loseAfterConfiguration || modelReads++ > 0)) {
				loseModel = false;
				models = models.map(value => value.modelId === lostRecognizerId
					? { ...value, availability: 'installable', installedBytes: null } : value);
			}
			return models.filter(value => value.availability === 'installed')
				.map(({ modelId, version, task }) => ({ modelId, version, task, artifactSha256s: ['a'.repeat(64)] }));
		},
		workflow: { createJob: loseAfterConfiguration ? async () => ({ contractVersion: 1, jobId: 'a'.repeat(40) }) : unused,
			run: unused, cancel: unused, readOutput: unused,
			onProgress: () => () => undefined,
			custody: { stageInput: unused, reserveOutput: unused, bindProducer: unused, release: async () => true } },
	} : null;
	const preparation = loseRecognizer ? {
		listSelectedMedia: async () => ({ sources: [{ sourceId: 'source-1', label: 'Selection',
			mediaKind: 'audio' as const, operations: ['speech-recognition' as const] }] }),
		prepareSelectedMedia: unused, prepareAdvancedWorkflow: unused,
		prepareGuidedWorkflow: loseAfterConfiguration ? async () => ({ outcome: 'unavailable' as const,
			reason: 'model-binding-unavailable' as const }) : unused,
	} : null;
	try {
		await act(async () => root.render(<LocalAssistanceDialogSurface bridgeScope={runtime ? { ...bridge, localAssistance: runtime } : bridge}
			request={{ mode: 'task', workflowId }} projectId="project" preparation={preparation}
			copy={ENGLISH_COPY} onClose={() => undefined} />));
		await run(dom, installs, removals, bridge);
	} finally {
		await act(async () => root.unmount());
		scope.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}

test('Transcribe Captions keeps missing required recognizer downloads ahead of runtime activation', async () => {
	await mounted('transcribe-captions', [SILERO, PARAKEET], async (dom, installs) => {
		assert.ok(dom.find('[data-assistance-model-prerequisites]'),
			'installed speech detection alone must not bypass the missing recognizer');
		assert.match(dom.container.textContent, /Parakeet TDT/u);
		assert.equal(dom.find('[data-local-assistance]'), null);
		const download = dom.one('[data-assistance-model-prerequisites]').querySelectorAll('button')
			.find(button => button.textContent === 'Download all');
		assert.ok(download);
		await act(async () => { await reactProps(download).onClick(); });
		assert.deepEqual(installs, [PARAKEET.modelId]);
		assert.equal(dom.find('[data-assistance-model-prerequisites]'), null);
	});
});

test('re-downloading a lost recognizer preserves its healthy installed speech-detection model', async () => {
	await mounted('transcribe-captions', [SILERO, { ...PARAKEET, availability: 'installed' }],
		async (dom, installs, removals) => {
			for (let attempt = 0; attempt < 100 && !dom.find('[data-assistance-model-prerequisites]'); attempt += 1) {
				await act(async () => new Promise<void>(resolve => setTimeout(resolve, 10)));
			}
			const prerequisite = dom.one('[data-assistance-model-prerequisites]');
			assert.match(prerequisite.textContent, /Parakeet TDT/u);
			assert.doesNotMatch(prerequisite.textContent, /Silero VAD/u);
			const download = prerequisite.querySelectorAll('button').find(button => button.textContent === 'Re-download');
			assert.ok(download);
			await act(async () => { await reactProps(download).onClick(); });
			assert.deepEqual(installs, [PARAKEET.modelId]);
			assert.deepEqual(removals, []);
			assert.equal(dom.find('[data-assistance-model-prerequisites]'), null);
		}, true);
});

test('a sole installed alternative recognizer satisfies the task without a download or picker', async () => {
	await mounted('transcribe-captions', [SILERO, PARAKEET, WHISPER, ALIGNMENT], async (dom, installs) => {
		assert.equal(dom.find('[data-assistance-model-prerequisites]'), null);
		assert.deepEqual(installs, []);
		assert.equal(dom.container.querySelectorAll('[role="group"]')
			.some(group => group.getAttribute('aria-label') === 'Model'), false);
	});
});

test('installing another recognizer preserves the admitted task settings', async () => {
	await mounted('transcribe-captions', [SILERO, PARAKEET, WHISPER], async (dom, _installs, _removals, bridge) => {
		const whisperAlignment = () => dom.container.querySelectorAll('[role="checkbox"]')
			.find(node => node.getAttribute('aria-label') === 'Improve English word timing when available');
		assert.ok(whisperAlignment());
		await act(async () => { await localModelManagerStoreFor(bridge).install(PARAKEET.modelId); });
		assert.ok(whisperAlignment(), 'an installed alternative must not reset the current Whisper settings');
	});
});

test('recovery requests the sole recognizer admitted before it disappears from runtime inventory', async () => {
	await mounted('transcribe-captions', [SILERO, WHISPER], async (dom, installs, removals) => {
		for (let attempt = 0; attempt < 100 && !dom.find('[data-assistance-model-prerequisites]'); attempt += 1) {
			await act(async () => new Promise<void>(resolve => setTimeout(resolve, 10)));
		}
		const prerequisite = dom.one('[data-assistance-model-prerequisites]');
		assert.match(prerequisite.textContent, /Whisper/u);
		assert.doesNotMatch(prerequisite.textContent, /Parakeet TDT|Silero VAD/u);
		const download = prerequisite.querySelectorAll('button').find(button => button.textContent === 'Re-download');
		assert.ok(download);
		assert.equal(download.disabled, false);
		await act(async () => { await reactProps(download).onClick(); });
		assert.deepEqual(installs, [WHISPER.modelId]);
		assert.deepEqual(removals, []);
		assert.equal(dom.find('[data-assistance-model-prerequisites]'), null);
	}, true, WHISPER.modelId);
});

test('a model lost while configuration is open offers re-download after typed preparation refusal', async () => {
	await mounted('transcribe-captions', [SILERO, { ...PARAKEET, availability: 'installed' }], async (dom, installs) => {
		let analyze = dom.container.querySelectorAll('button').find(button => button.textContent === 'Analyze');
		for (let attempt = 0; attempt < 100 && (!analyze || analyze.disabled); attempt += 1) {
			await act(async () => new Promise<void>(resolve => setTimeout(resolve, 10)));
			analyze = dom.container.querySelectorAll('button').find(button => button.textContent === 'Analyze');
		}
		assert.ok(analyze);
		assert.equal(analyze.disabled, false);
		await act(async () => { await reactProps(analyze).onClick(); });
		for (let attempt = 0; attempt < 100 && !dom.find('[data-assistance-model-prerequisites]'); attempt += 1) {
			await act(async () => new Promise<void>(resolve => setTimeout(resolve, 10)));
		}
		const prerequisite = dom.one('[data-assistance-model-prerequisites]');
		assert.match(prerequisite.textContent, /A required model is missing or unavailable/u);
		assert.doesNotMatch(prerequisite.textContent, /Silero VAD/u,
			'fresh runtime inventory must preserve healthy dependencies after a cached-model refusal');
		assert.ok(prerequisite.querySelectorAll('button').find(button => button.textContent === 'Re-download'));
		assert.deepEqual(installs, [], 'preparation refusal must ask before downloading anything');
	}, true, PARAKEET.modelId, true);
});

test('optional alignment alone does not replace the required task recognizer', async () => {
	await mounted('transcribe-captions', [SILERO, PARAKEET, { ...ALIGNMENT, availability: 'installed' }], async dom => {
		assert.ok(dom.find('[data-assistance-model-prerequisites]'));
		assert.equal(dom.find('[data-local-assistance]'), null);
	});
});

test('Identify Speakers waits for both required model roles', async () => {
	const segmentation = model('pyannote-segmentation-3.0', '3.0.0', 'speaker-segmentation', 'installed');
	const embedding = model('speech-3d-speaker-eres2net', '1.0.0', 'speaker-embedding', 'installable');
	await mounted('identify-speakers', [segmentation, embedding], async dom => {
		assert.ok(dom.find('[data-assistance-model-prerequisites]'));
		assert.equal(dom.find('[data-local-assistance]'), null);
	});
});

test('a ready default transcript task admits without requiring optional models or alternate recognizers', async () => {
	await mounted('transcribe-captions', [SILERO, { ...PARAKEET, availability: 'installed' },
		{ ...WHISPER, availability: 'installable' }, ALIGNMENT], async dom => {
		assert.equal(dom.find('[data-assistance-model-prerequisites]'), null);
	});
});

test('installed exact editorial model admits its default opt-in control without requiring another download', async () => {
	const qwen = model('qwen3-4b-q4-k-m', '1.0.0', 'editorial-generation', 'installed');
	await mounted('generate-editorial-text', [qwen], async (dom, installs) => {
		assert.equal(dom.find('[data-assistance-model-prerequisites]') === null, true,
			'installed exact Qwen must admit the existing Generate text suggestions choice');
		for (let attempt = 0; attempt < 100 && !dom.find('[data-local-assistance]'); attempt += 1) {
			await act(async () => new Promise<void>(resolve => setTimeout(resolve, 10)));
		}
		const choice = dom.container.querySelectorAll('[role="checkbox"]')
			.find(node => node.getAttribute('aria-label') === 'Generate text suggestions');
		assert.ok(choice);
		assert.equal(choice.getAttribute('aria-checked'), 'false');
		await act(async () => reactProps(choice).onClick());
		assert.equal(choice.getAttribute('aria-checked'), 'true');
		assert.deepEqual(installs, []);
	});
});
