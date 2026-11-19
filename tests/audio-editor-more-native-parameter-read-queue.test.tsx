/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NativePluginParameterControls from '../src/common/editor/ui/dialogs/NativePluginParameterControls.tsx';
import { nativeParameterHostCustody } from './helpers/native-parameter-host-custody.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const retire of [false, true]) test(`${retire ? 'closing' : 'opening'} generated native controls leaves room for audio in the production host queue`, async context => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let mounted = true;
	const parameters = Array.from({ length: 32 }, (_, index) => ({ index, id: `parameter-${index}`,
		name: `Parameter ${index}`, label: '', defaultValue: 0.5, minimumValue: 0, maximumValue: 1, flags: 8 }));
	let fixture: Awaited<ReturnType<typeof nativeParameterHostCustody>> | undefined;
	try {
		fixture = await nativeParameterHostCustody(context, { instanceId: `parameter-queue-${retire ? 'closing' : 'opening'}`,
		parameters, values: parameters.map(() => .5), holdFirstRead: true });
		const { instanceId } = fixture;
		await act(async () => { root.render(<NativePluginParameterControls instanceId={instanceId} />); });
		assert.equal(dom.container.querySelectorAll('[role="alert"]').length, 0);
		await fixture.readEntered;
		assert.equal(fixture.state.requests.filter(kind => kind === 'parameter-get').length, 1,
			'only one generated-control read reaches the host while its first reply is held');
		if (retire) { await act(async () => { root.unmount(); }); mounted = false; }
		const audio = fixture.processPacket();
		fixture.releaseReads();
		await act(async () => { await audio; });
		assert.equal(fixture.state.readsBeforeAudio, 1, 'the audio packet must not sit behind the entire generated-control read inventory');
		if (retire) assert.equal(fixture.state.completedReads, 1, 'dismissed generated controls stop loading the remaining inventory');
		else {
			assert.equal(fixture.state.completedReads, 32);
			assert.equal(dom.container.querySelectorAll('[data-native-plugin-parameter]').length, 32,
				'all generated controls appear after the held read is released');
		}
	} finally {
		fixture?.releaseReads();
		if (mounted) await act(async () => { root.unmount(); });
		await fixture?.dispose();
		reactGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
