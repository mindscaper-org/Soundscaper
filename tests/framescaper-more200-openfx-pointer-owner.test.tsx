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

for (const gesture of ['secondary', 'other-device', 'cancel', 'capture-loss'] as const) test(`OpenFX keeps one pen owner through ${gesture}`, async () => {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const requests: FramescaperOpenFxInteractRequestV1[] = [];
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
				commitInteract: async () => instance,
			}} />));
		const canvas = dom.one('[data-framescaper-openfx-interact-canvas="64x64"]');
		const props = reactProps(canvas);
		const focus = canvas.focus.bind(canvas);
		canvas.focus = () => { focus(); props.onFocus(); };
		const pointer = (pointerId: number, isPrimary = true) => ({ currentTarget: canvas,
			pointerId, isPrimary, clientX: 40 + pointerId, clientY: 40, button: 0, buttons: 1,
			altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
		await act(async () => {
			props.onPointerDown(pointer(1));
			if (gesture === 'secondary' || gesture === 'other-device') {
				const other = pointer(2, gesture === 'other-device');
				props.onPointerDown(other); props.onPointerMove(other); props.onPointerUp(other);
			} else if (gesture === 'cancel') props.onPointerCancel(pointer(1));
			else props.onLostPointerCapture(pointer(1));
			props.onPointerMove(pointer(1));
			props.onPointerUp(pointer(1));
			props.onBlur();
			await new Promise<void>(resolve => setImmediate(resolve));
		});
		const replay = requests.filter(({ events }) => events.length > 0).at(-1)?.events ?? [];
		const pen = replay.filter(event => event.kind === 'pointer');
		assert.equal(pen.filter(event => event.phase === 'down').length, 1, 'another pointer cannot start a second native pen');
		assert.equal(pen.filter(event => event.phase === 'up').length, 1, 'release, cancellation and capture loss finish the owner exactly once');
		if (gesture === 'secondary' || gesture === 'other-device') assert.deepEqual(pen.map(event => event.phase), ['down', 'motion', 'up']);
		else assert.deepEqual(pen.map(event => event.phase), ['down', 'up'], 'late pointer-up after cancellation cannot emit a second native release');
		await act(async () => {
			props.onPointerDown(pointer(3)); props.onPointerUp(pointer(3)); props.onBlur();
			await new Promise<void>(resolve => setImmediate(resolve));
		});
		assert.deepEqual(requests.at(-1)?.events.filter(event => event.kind === 'pointer').map(event => event.phase),
			['down', 'up'], 'the next gesture obtains a fresh pen owner');

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
