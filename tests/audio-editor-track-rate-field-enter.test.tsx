/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EditorDialog from '../src/common/editor/ui/dialogs/EditorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const type of ['resample', 'track-rate'] as const) {
	for (const scenario of ['valid', 'invalid', 'blocked', 'modified', 'composing', 'arrow-button'] as const) {
		test(`${type} confirms its completed number field with Enter: ${scenario}`, async () => {
			const dom = installReactTestDom();
			const root = createRoot(dom.container as unknown as HTMLElement);
			const global = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
			const priorAct = global.IS_REACT_ACT_ENVIRONMENT;
			const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
			global.IS_REACT_ACT_ENVIRONMENT = true;
			Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
			const calls: unknown[][] = [];
			let closes = 0;
			const update = (...args: unknown[]) => { calls.push(args); return Promise.resolve(); };
			try {
				await act(async () => { root.render(<EditorDialog type={type} value={scenario === 'invalid' ? '' : '24000'}
					onValueChange={() => undefined} trackId="track" controller={{ actions: { track: { resample: update, setRate: update } } }}
					snapshot={{ project: { id: 'project' }, selectedTrackId: 'track', recording: scenario === 'blocked', recordingInputs: {} }}
					copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => operation()} onClose={() => { closes++; }} />); });
				const input = dom.one('input');
				await act(async () => {
					reactProps(dom.one('form')).onKeyDownCapture?.({ key: 'Enter', defaultPrevented: false,
						target: scenario === 'arrow-button' ? dom.one('[aria-label="Increase value"]') : input,
						ctrlKey: scenario === 'modified', metaKey: false, altKey: false,
						nativeEvent: { isComposing: scenario === 'composing' }, preventDefault() {}, stopPropagation() {} });
					await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
				});
				assert.deepEqual(calls, scenario === 'valid' ? [['track', 24000]] : []);
				assert.equal(closes, scenario === 'valid' ? 1 : 0);
			} finally {
				await act(async () => { root.unmount(); });
				if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
				dom.restore(); global.IS_REACT_ACT_ENVIRONMENT = priorAct;
			}
		});
	}
}
