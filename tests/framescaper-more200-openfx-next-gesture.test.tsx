/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperOpenFxInteractPanel from '../src/common/editor/ui/dialogs/FramescaperOpenFxInteractPanel.tsx';
import type { FramescaperOpenFxInteractRequestV1 } from '../src/common/editor/native-ofx-interact-contract.ts';
import type { FramescaperOpenFxInteractInstanceNativeMedia } from '../src/framescaper/editor-native-openfx-action.ts';
import type { FramescaperNativeServicesBridge } from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import { resolveFramescaperNativeServicesCopy } from '../src/common/editor/ui/framescaper-native-services-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const delayed of [true, false]) test(`OpenFX preserves the next gesture with ${delayed ? 'pending' : 'completed'} prior publication`, async () => {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let instance = authoredInstance();
	let release = (): void => { throw new Error('Completion gate unavailable'); };
	const held = new Promise<void>(resolve => { release = resolve; });
	let markStarted = (): void => { throw new Error('Start gate unavailable'); };
	const started = new Promise<void>(resolve => { markStarted = resolve; });
	const commits: FramescaperOpenFxInteractRequestV1[] = [];
	let first = true;
	const bridge: FramescaperNativeServicesBridge = {
		snapshot: async () => ({ snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true, queue: [], roots: [], watchRules: [] }),
		control: async () => { throw new Error('Unused'); }, reorder: async () => [], remove: async () => false,
		runOpenFxInteract: async request => {
			const end = request.events.at(-1), terminal = end?.kind === 'focus' && !end.focused;
			if (terminal && first) { first = false; markStarted(); if (delayed) await held; }
			const count = request.effect.parameters[0]; assert.ok(count?.type === 'integer');
			assert.ok(typeof count.value === 'number'); const initial = count.value;
			return { protocolVersion: 1, project: request.project, instanceId: request.effect.instanceId,
				effectStateSha256: request.effectStateSha256, width: 64, height: 64, rowBytes: 256,
				target: request.target, parameterName: request.parameterName,
				acceptedSequences: request.events.map(({ sequence }) => sequence), redrawRequested: false,
				surfaceDisposition: 'retained', parameterMutations: terminal ? [{ parameter: { ...count,
					value: initial + request.events.filter(event => event.kind === 'keyboard' && event.phase === 'down').length } }] : [],
				rgba: new Uint8Array(64 * 64 * 4) };
		},
	};
	const turn = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
	try {
		await act(async () => root.render(<FramescaperOpenFxInteractPanel bridge={bridge} copy={resolveFramescaperNativeServicesCopy()}
			runtime={{ model: async () => ({ plugins: [], targets: [] }), author: async () => undefined,
				interactModel: async () => ({ instances: [instance] }), commitInteract: async (request, result) => {
					commits.push(request);
					instance = { ...instance, project: { ...instance.project, revision: instance.project.revision + 1 },
						effect: { ...instance.effect, parameters: result.parameterMutations.map(({ parameter }) => parameter) } };
					return instance;
				} }} />));
		const props = reactProps(dom.one('[data-framescaper-openfx-interact-canvas="64x64"]'));
		const key = { key: 'ArrowRight', code: 'ArrowRight', nativeEvent: { isComposing: false },
			altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {} };
		await act(async () => { props.onFocus(); props.onKeyDown(key); props.onKeyUp(key); props.onBlur(); await started; });
		await act(async () => { props.onFocus(); props.onKeyDown(key); release(); await turn(); await turn(); });
		await act(async () => { props.onKeyUp(key); props.onBlur(); await turn(); await turn(); });
		assert.equal(commits.length, 2);
		assert.equal(instance.effect.parameters[0]?.value, 2, 'both completed physical gestures must survive');
		assert.deepEqual(commits[1]?.events.map(event => event.kind === 'focus' ? `focus:${String(event.focused)}` : `${event.kind}:${event.phase}`),
			['focus:true', 'keyboard:down', 'keyboard:up', 'focus:false']);
	} finally {
		release(); await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore();
	}
});

function authoredInstance(): FramescaperOpenFxInteractInstanceNativeMedia {
	const sha = '11'.repeat(32);
	return { project: { schemaFamily: 'framescaper', schemaVersion: 1, id: 'gesture-project', revision: 7 },
		pluginHandle: '12'.repeat(20), label: 'Filter', customParameterNames: [],
		effect: { schemaVersion: 1, instanceId: 'filter', pluginId: 'net.example.Filter', binarySha256: '22'.repeat(32),
			context: 'filter', attachment: { kind: 'filter', targetId: 'clip' }, inputs: [],
			parameters: [{ name: 'count', type: 'integer', value: 0, keyframes: [] }], customEncodings: {}, enabled: true,
			freshness: { authoredStateSha256: sha, inputIdentitiesSha256: sha, renderPlanFingerprintSha256: sha, nativeEffectFingerprintSha256: sha }, frozenFallback: null } };
}
