/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SoundscaperVampAnalyzerSurface from '../src/common/editor/ui/workspace/SoundscaperVampAnalyzerSurface.tsx';
import type { EnginePublicApi } from '../src/common/editor/engine/public-api.ts';
import type { SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const retire of [false, true]) test(`Vamp publication ${retire ? 'retires on activation' : 'survives its own revision'}`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	let generation = 1, commits = 0, closes = 0;
	let acknowledge = (): void => {};
	const acknowledged = new Promise<void>(resolve => { acknowledge = resolve; });
	const project = { id: 'vamp', revision: 0, sampleRate: 48_000, tracks: [{ id: 'voice', type: 'audio', clipIds: [] }], clips: [],
		selection: { startFrame: 0, endFrame: 4, trackIds: ['voice'], clipIds: [] } };
	const controller = { project,
		captureProjectGeneration: () => ({ projectId: project.id, generation }),
		actions: { edit: { commit: () => {
			commits += 1; controller.project = { ...controller.project, revision: 1 }; render(); return acknowledged;
		} } } };
	const output = { identifier: 'onsets', name: 'Onsets', description: '', unit: '', binCount: null,
		binNames: [], extents: null, quantizeStep: null, sampleType: 'one-sample-per-step', sampleRate: null, hasDuration: false };
	const bridge = {
		listNativeVampAnalyzers: async () => [{ analyzerId: 'onsets', stableId: 'fixture', binarySha256: 'ab'.repeat(32),
			name: 'Onsets', maker: 'Fixture', programs: [], parameters: [],
			outputs: [{ id: 'onsets', name: 'Onsets', description: '', unit: '', sampleType: 'one-sample-per-step', sampleRate: null, hasDuration: false }],
			configuration: { inputDomain: 'time', minimumChannels: 1, maximumChannels: 2, preferredStepSize: 2, preferredBlockSize: 4 } }],
		startNativeVampAnalyzer: async () => ({ sessionId: 'session' }),
		configureNativeVampAnalyzer: async () => ({ kind: 'analyzer-session', format: 'vamp', sessionId: 'session',
			analyzerId: 'onsets', installationId: 'fixture', binarySha256: 'ab'.repeat(32), state: 'configured',
			processedFrames: 0, totalFrames: 4, outputs: [output] }),
		pushNativeVampAnalyzerPcm: async () => ({ features: [] }),
		finishNativeVampAnalyzer: async () => ({ features: [{ outputId: 'onsets', timestamp: null, duration: null, values: [], label: 'Onset' }] }),
		cancelNativeVampAnalyzer: async () => true,
	} as unknown as SoundscaperNativeServicesBridge;
	const engine = { renderTrack: async () => ({ channels: [new Float32Array(4).fill(.25)] }) } as unknown as EnginePublicApi;
	function render(): void {
		root.render(<SoundscaperVampAnalyzerSurface input={{ controller, bridge, engine, durationFrames: 4,
			selectedTrackId: 'voice', selectedClipId: null, projectToken: controller.project }} onClose={() => { closes += 1; }} />);
	}
	async function flush(): Promise<void> { await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); }); }
	async function click(name: string): Promise<void> {
		const button = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === name);
		assert.ok(button); await act(async () => { reactProps(button).onClick(); });
	}
	try {
		await import('../src/common/editor/ui/dialogs/VampAnalyzerDialog.tsx');
		await act(async () => { render(); });
		for (let attempt = 0; attempt < 20 && !dom.find('select'); attempt += 1) await flush();
		await click('Analyze');
		for (let attempt = 0; attempt < 20 && !dom.container.textContent.includes('1 feature'); attempt += 1) await flush();
		await click('Publish labels');
		for (let attempt = 0; attempt < 20 && commits === 0; attempt += 1) await flush();
		assert.equal(commits, 1);
		if (retire) {
			generation += 1; controller.project = { ...project };
			await act(async () => { render(); }); await flush();
		}
		await act(async () => { acknowledge(); await acknowledged; }); await flush();
		assert.equal(closes, retire ? 0 : 1);
		assert.equal(commits, 1);
	} finally {
		acknowledge(); await act(async () => root.unmount()); dom.restore();
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
	}
});
