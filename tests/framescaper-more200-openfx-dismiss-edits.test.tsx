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

for (const mode of ['dismiss', 'composing', 'prevented', 'ordinary'] as const) test(`OpenFX completes its focused interaction before Escape dismissal: ${mode}`, async () => {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const requests: FramescaperOpenFxInteractRequestV1[] = [];
	const commits: FramescaperOpenFxInteractRequestV1[] = [];
	const instance = authoredInstance();
	const bridge: FramescaperNativeServicesBridge = {
		snapshot: async () => ({ snapshotVersion: 1, runtimeAvailable: true,
			nativeMediaEnabled: true, queue: [], roots: [], watchRules: [] }),
		control: async () => { throw new Error('Not used'); }, reorder: async () => [], remove: async () => false,
		runOpenFxInteract: async request => {
			requests.push(request);
			return { protocolVersion: 1, project: request.project, instanceId: request.effect.instanceId,
				effectStateSha256: request.effectStateSha256, width: 64, height: 64, rowBytes: 256,
				target: request.target, parameterName: request.parameterName,
				acceptedSequences: request.events.map(({ sequence }) => sequence), redrawRequested: false,
				surfaceDisposition: 'retained', parameterMutations: [], rgba: new Uint8Array(64 * 64 * 4) };
		},
	};
	try {
		await act(async () => root.render(<FramescaperOpenFxInteractPanel bridge={bridge}
			copy={resolveFramescaperNativeServicesCopy()} runtime={{
				model: async () => ({ plugins: [], targets: [] }), author: async () => undefined,
				interactModel: async () => ({ instances: [instance] }),
				commitInteract: async request => { commits.push(request); return instance; },
			}} />));
		const canvas = dom.one('[data-framescaper-openfx-interact-canvas="64x64"]');
		const props = reactProps(canvas);
		Object.defineProperty(canvas, 'blur', { configurable: true, value: () => props.onBlur() });
		await act(async () => {
			props.onFocus();
			props.onKeyDown({ currentTarget: canvas, key: mode === 'ordinary' ? 'a' : 'Escape',
				code: mode === 'ordinary' ? 'KeyA' : 'Escape', defaultPrevented: mode === 'prevented', nativeEvent: { isComposing: mode === 'composing' },
				altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
			await new Promise<void>(resolve => setImmediate(resolve));
		});
		assert.equal(commits.length, mode === 'dismiss' ? 1 : 0, 'only an accepted dialog Escape completes the pending edit');
		const replay = requests.filter(({ events }) => events.length > 0).at(-1)?.events ?? [];
		assert.deepEqual(replay.map(event => event.kind === 'focus' ? `focus:${String(event.focused)}` : `${event.kind}:${event.phase}`),
			mode === 'dismiss' ? ['focus:true', 'keyboard:down', 'focus:false'] : ['focus:true', 'keyboard:down']);

	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function authoredInstance(): FramescaperOpenFxInteractInstanceNativeMedia {
	const sha = '11'.repeat(32);
	return {
		project: { schemaFamily: 'framescaper', schemaVersion: 1, id: 'focus-project', revision: 7 },
		pluginHandle: '12'.repeat(20), label: 'Filter control', customParameterNames: [],
		effect: { schemaVersion: 1, instanceId: 'filter-instance', pluginId: 'net.example.Filter',
			binarySha256: '22'.repeat(32), context: 'filter', attachment: { kind: 'filter', targetId: 'clip-1' },
			inputs: [], parameters: [], customEncodings: {}, enabled: true,
			freshness: { authoredStateSha256: sha, inputIdentitiesSha256: sha,
				renderPlanFingerprintSha256: sha, nativeEffectFingerprintSha256: sha }, frozenFallback: null },
	};
}
