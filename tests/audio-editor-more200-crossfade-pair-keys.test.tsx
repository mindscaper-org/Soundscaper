/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CrossfadeOverlays } from '../src/common/editor/ui/timeline/CrossfadeOverlays.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('replacing one of two distinct crossfade pairs removes its outgoing visual', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const render = async (firstId: string) => {
		const overlays = [[firstId, 'c'], ['a', 'b:c']].map(([outgoingClipId, incomingClipId], index) => ({
			id: `overlap-${String(index)}`, outgoingClipId: outgoingClipId!, incomingClipId: incomingClipId!,
			left: index * 200, width: 100, outgoingPath: 'M0 0 L100 100', incomingPath: 'M0 100 L100 0',
			intersectionPosition: .5, intersectionGain: .5, minimumPosition: .05, maximumPosition: .95,
			label: `Crossfade ${String(index)}`,
		}));
		await act(async () => { root.render(<CrossfadeOverlays overlays={overlays}
			clipLookup={new Map(['a:b', 'c', 'a', 'b:c', 'split'].map(id => [id, { id }]))}
			selectedIds={new Set()} top={0} height={80} blocked={false} copy={ENGLISH_COPY}
			controller={{ actions: { edit: { commit() {} } } }} run={operation => operation()} onTabOut={() => undefined} />); });
	};
	try {
		await render('a:b');
		assert.equal(dom.container.querySelectorAll('[data-crossfade-handle]').length, 2);
		await render('split');
		assert.equal(dom.container.querySelectorAll('[data-crossfade-handle]').length, 2);
	} finally {
		await act(async () => { root.unmount(); });
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});
