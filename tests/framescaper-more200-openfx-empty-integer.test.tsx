/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FramescaperOpenFxAddForm } from '../src/common/editor/ui/dialogs/FramescaperOpenFxAddPanel.tsx';
import type { FramescaperOpenFxAuthoringModelNativeMedia, FramescaperOpenFxAuthoringRequestNativeMedia }
	from '../src/framescaper/editor-native-openfx-authoring-model.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const MODEL = {
	plugins: [{ pluginHandle: '12'.repeat(20), pluginId: 'net.example.Numeric', vendor: 'Example',
		version: { major: 1, minor: 0 }, binarySha256: 'ab'.repeat(32), supportedContexts: ['filter'],
		parameters: [{ name: 'count', type: 'integer', animates: false }, { name: 'mode', type: 'choice', animates: false }],
		components: ['RGBA'], pixelDepths: ['byte'], threading: 'instance-safe', state: 'enabled', quarantined: false }],
	targets: [{ context: 'filter', targetId: 'clip', instanceId: null, label: 'Picture', inputs: [{ name: 'Source', sourceRef: 'source' }] }],
} satisfies FramescaperOpenFxAuthoringModelNativeMedia;

for (const type of ['integer', 'choice']) for (const blank of ['', ' \t ']) {
	test(`OpenFX Add refuses ${JSON.stringify(blank)} ${type} input while admitting explicit zero`, async () => {
		const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const requests: FramescaperOpenFxAuthoringRequestNativeMedia[] = [];
		try {
			await act(async () => root.render(<FramescaperOpenFxAddForm model={MODEL} onAuthor={request => { requests.push(request); }} />));
			const input = dom.one(`[data-openfx-parameter-type="${type}"]`).querySelector('input'), form = dom.one('form'); assert.ok(input);
			await act(async () => reactProps(input).onChange({ currentTarget: { value: blank } }));
			await act(async () => reactProps(form).onSubmit({ preventDefault() {} }));
			assert.equal(requests.length, 0, 'a missing numeric value must not publish a zero-valued effect');
			assert.match(dom.one('[role="alert"]').textContent, /integer/iu);
			await act(async () => reactProps(input).onChange({ currentTarget: { value: '0' } }));
			await act(async () => reactProps(form).onSubmit({ preventDefault() {} }));
			assert.equal(requests.length, 1);
			assert.equal(requests[0]?.parameters.find(parameter => parameter.type === type)?.value, 0);
		} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
	});
}
