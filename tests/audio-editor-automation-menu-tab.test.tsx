/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { TrackAutomationCurveMenu } from '../src/common/editor/ui/timeline/TrackAutomationCurveMenu.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const shiftKey of [false, true]) test(`automation menu dismisses for ${shiftKey ? 'Shift+Tab' : 'Tab'} while allowing native navigation`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const anchor = dom.container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
	anchor.setAttribute('tabindex', '0');
	dom.container.ownerDocument.body.appendChild(anchor);
	function View() {
		const [open, setOpen] = useState(true);
		return open && <TrackAutomationCurveMenu
			menu={{ x: 0, y: 0, segmentIndex: 0, returnFocus: anchor as unknown as SVGPathElement }}
			lane={null} descriptor={stripParameterDescriptor({ kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'gain' })}
			width={500} height={250} bodyTop={0} copy={{}} onKind={() => undefined}
			onDelete={() => undefined} onClose={() => setOpen(false)} />;
	}
	try {
		await act(async () => root.render(<View />));
		const menu = dom.container.ownerDocument.body.querySelector('[role="menu"]');
		assert.ok(menu);
		const first = menu.querySelector('[role="menuitemradio"]');
		assert.ok(first);
		assert.strictEqual(first.ownerDocument.activeElement, first);
		let prevented = false;
		await act(async () => reactProps(menu).onKeyDown({ key: 'Tab', shiftKey, target: first,
			preventDefault() { prevented = true; }, stopPropagation() {} }));
		assert.equal(Boolean(dom.container.ownerDocument.body.querySelector('[role="menu"]')), false);
		assert.equal(prevented, false, 'native Tab decides the next control after the surviving anchor');
		assert.strictEqual(anchor.ownerDocument.activeElement, anchor);
	} finally {
		await act(async () => root.unmount());
		anchor.parentNode?.removeChild(anchor);
		globals.IS_REACT_ACT_ENVIRONMENT = prior;
		dom.restore();
	}
});
