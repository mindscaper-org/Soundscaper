/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ManualValueDialog } from '../vendor/audacity-design-system/components/src/ManualValueDialog/ManualValueDialog.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape']) {
	for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
		test(`manual entry preserves composing ${key} (${Object.keys(nativeEvent)[0]})`, async context => {
			context.mock.timers.enable({ apis: ['setTimeout'] });
			const dom = installReactTestDom();
			const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
			const prior = globals.IS_REACT_ACT_ENVIRONMENT;
			globals.IS_REACT_ACT_ENVIRONMENT = true;
			const root = createRoot(dom.container as unknown as Element);
			const applied: number[] = [];
			let closed = 0, prevented = false, stopped = false;
			const render = (open: boolean) => <div data-audio-editor><button data-opener>Volume</button>
				<ManualValueDialog isOpen={open} title="Volume" value={25}
					onApply={value => { applied.push(value); }} onClose={() => { closed++; }} /></div>;
			try {
				await act(async () => root.render(render(false)));
				dom.one('[data-opener]').focus();
				await act(async () => root.render(render(true)));
				const wrapper = dom.one('[data-manual-value-dialog]');
				const event = { key, nativeEvent, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
				await act(async () => {
					reactProps(wrapper).onKeyDownCapture?.(event);
					if (!stopped) reactProps(wrapper).onKeyDown?.(event);
				});
				assert.deepEqual(applied, []);
				assert.equal(closed, 0);
				assert.equal(prevented, false, 'native input method confirmation remains available');
				assert.equal(stopped, true, 'ancestor dialogs cannot submit or dismiss the composition');
			} finally {
				await act(async () => root.unmount());
				context.mock.timers.reset();
				globals.IS_REACT_ACT_ENVIRONMENT = prior;
				dom.restore();
			}
		});
	}
}
