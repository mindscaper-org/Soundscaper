/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NativePluginParameterControls from '../src/common/editor/ui/dialogs/NativePluginParameterControls.tsx';
import { pendingNativePluginParameterWrites } from '../src/common/editor/ui/native-plugin-parameter-write-drain.ts';
import { nativeParameterHostCustody } from './helpers/native-parameter-host-custody.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('native normalized parameter positions never masquerade as plug-in engineering units', async context => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		for (const [id, name, label, defaultValue] of [['gain', 'Gain', 'dB', .25], ['frequency', 'Frequency', 'Hz', .5]] as const) {
			const host = await nativeParameterHostCustody(context, { instanceId: `parameter-units-${id}`,
				parameters: [{ index: 0, id, name, label, defaultValue, minimumValue: 0, maximumValue: 1, flags: 8 }], values: [.25] });
			try {
				await act(async () => { root.render(<NativePluginParameterControls key={id} instanceId={host.instanceId} />); });
				const range = dom.one(`[data-native-plugin-parameter="${id}"]`);
				assert.equal(range.value, '0.25');
				assert.equal(dom.one('output').textContent, '25%');
				assert.equal(range.getAttribute('aria-valuetext'), '25%');
				assert.equal(host.state.completedReads, 1);
				await act(async () => {
					reactProps(range).onChange({ currentTarget: { value: '0' } });
					await pendingNativePluginParameterWrites(host.instanceId);
				});
				assert.deepEqual(host.state.values, [0]);
				assert.deepEqual(host.state.writes, [{ index: 0, value: 0 }]);
				assert.equal(range.value, '0');
				assert.equal(dom.one('output').textContent, '0%');
				assert.equal(range.getAttribute('aria-valuetext'), '0%');
			} finally {
				await act(async () => { root.render(null); });
				await host.dispose();
			}
		}
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
