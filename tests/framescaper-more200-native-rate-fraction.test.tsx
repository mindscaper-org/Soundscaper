/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperNativeProjectActionPanel from '../src/common/editor/ui/dialogs/FramescaperNativeProjectActionPanel.tsx';
import { resolveFramescaperNativeServicesCopy } from '../src/common/editor/ui/framescaper-native-services-copy.ts';
import { createFramescaperNativeProjectActionSubsetRuntime } from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import { snapshotFramescaperNativeImageSequenceImportRequestNativeMedia as importRequest,
	snapshotFramescaperNativeRenderDeliveryRequestNativeMedia as deliveryRequest } from '../src/framescaper/editor-native-project-action-requests.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const surface of ['image-sequence-import', 'render-queue-enqueue'] as const) {
	for (const [num, den, expected] of [[48, 2, { num: 24, den: 1 }],
		[60_000, 2_002, { num: 30_000, den: 1_001 }], [24, 1, { num: 24, den: 1 }],
		[2_000_000, 2, null], [1.5, 1, null], [0, 1, null]] as const) {
		test(`${surface} submits ${num}/${den} as its equivalent canonical exact rate`, async () => {
			const dom = installReactTestDom();
			const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
			Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
			const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
			const previousAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
			const root = createRoot(dom.container as unknown as Element);
			const admitted: { num: number; den: number }[] = [];
			const runtime = createFramescaperNativeProjectActionSubsetRuntime([surface], {
				[surface]: (request: unknown) => {
					if (surface === 'image-sequence-import') admitted.push(importRequest(request).frameRate);
					else {
						const delivery = deliveryRequest(request); assert.equal(delivery.kind, 'image-sequence');
						if (delivery.kind === 'image-sequence') admitted.push(delivery.frameRate);
					}
					return { cancelled: true } as const;
				},
			});
			try {
				await act(async () => root.render(<FramescaperNativeProjectActionPanel copy={resolveFramescaperNativeServicesCopy()}
					surface={surface} projectActions={runtime} title="Native file action" />));
				if (surface === 'render-queue-enqueue') await act(async () => reactProps(dom.one('select')).onChange({ currentTarget: { value: 'png' } }));
				const prefix = surface === 'image-sequence-import' ? 'image-sequence' : 'render';
				await act(async () => {
					reactProps(dom.one(`[data-framescaper-${prefix}-rate-num="true"]`)).onChange({ currentTarget: { value: String(num) } });
					reactProps(dom.one(`[data-framescaper-${prefix}-rate-den="true"]`)).onChange({ currentTarget: { value: String(den) } });
				});
				await act(async () => {
					reactProps(dom.one('form')).onSubmit({ preventDefault() {} });
					await new Promise<void>(resolve => setImmediate(resolve));
				});
				assert.deepEqual(admitted, expected === null ? [] : [expected], 'only valid UI fractions reach native admission');
				if (expected === null) assert.match(dom.container.textContent, /exact reduced rational/u);
				else assert.doesNotMatch(dom.container.textContent, /exact reduced rational/u);
			} finally {
				await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
				if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
				dom.restore();
			}
		});
	}
}

test('the native command boundary continues refusing noncanonical or invalid rates directly', () => {
	assert.throws(() => importRequest({ frameRate: { num: 48, den: 2 } }), /exact reduced rational/u);
	for (const frameRate of [{ num: 0, den: 1 }, { num: 1, den: 0 }, { num: 1.5, den: 1 }, { num: 2_000_000, den: 1 }]) {
		assert.throws(() => importRequest({ frameRate }), /exact reduced rational/u);
	}
});
