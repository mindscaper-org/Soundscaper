/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import NativePluginParameterControls, { type NativePluginParameterRuntime } from '../src/common/editor/ui/dialogs/NativePluginParameterControls.tsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('native normalized parameter positions never masquerade as plug-in engineering units', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	// The shipping JUCE adapter reports getValue()/getDefaultValue() in [0, 1],
	// while getLabel() still names the plug-in's physical unit.
	const runtime: NativePluginParameterRuntime = {
		async capabilities() { return { parameterCount: 1, hasVendorUi: false }; },
		async describeParameters() { return [{ index: 0, id: 'frequency', name: 'Frequency', label: 'Hz',
			defaultValue: 0.5, minimumValue: 0, maximumValue: 1, flags: 8 }]; },
		async readParameter() { return 0.25; },
		async writeParameter(_instance, _index, value) { return value; },
	};
	try {
		await act(async () => root.render(<NativePluginParameterControls instanceId="frequency" runtime={runtime} />));
		assert.equal(dom.one('output').textContent, '25%');
		assert.equal(dom.one('[data-native-plugin-parameter]').getAttribute('aria-valuetext'), '25%');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
