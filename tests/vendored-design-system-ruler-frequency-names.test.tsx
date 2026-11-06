/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RulerFlyout } from '../vendor/audacity-design-system/components/src/RulerFlyout/RulerFlyout.tsx';
import { ComponentCopyProvider } from '../vendor/audacity-design-system/components/src/contexts/ComponentCopyContext.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const [locale, minimum, maximum] of [['en', 'Min', 'Max'], ['de', 'Untergrenze', 'Obergrenze']] as const) {
	test(`${locale} ruler frequency inputs carry distinct localized names and retain editing`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const writes: Readonly<{ edge: string; frequency: number }>[] = [];
		function Flyout() {
			const [min, setMin] = useState(0); const [max, setMax] = useState(20_000);
			return <ComponentCopyProvider copy={{ minimum, maximum }} locale={locale}>
				<RulerFlyout isOpen x={8} y={8} mode="spectrogram" sampleRate={48_000}
					minFreq={min} maxFreq={max} onClose={() => undefined}
					onMinFreqChange={frequency => { writes.push({ edge: 'minimum', frequency }); setMin(frequency); }}
					onMaxFreqChange={frequency => { writes.push({ edge: 'maximum', frequency }); setMax(frequency); }} />
			</ComponentCopyProvider>;
		}
		try {
			await act(async () => root.render(<Flyout />));
			const fields = dom.container.querySelectorAll('.number-stepper__input');
			assert.equal(fields.length, 2);
			assert.deepEqual(fields.map(field => field.getAttribute('aria-label')), [minimum, maximum]);
			await act(async () => reactProps(fields[0]!).onChange({ target: { value: '500' } }));
			await act(async () => reactProps(fields[1]!).onChange({ target: { value: '12000' } }));
			assert.deepEqual(writes, [], 'typing retains its own draft until confirmation');
			for (const field of fields) {
				const stepper = field.closest('.number-stepper'); assert.ok(stepper);
				const owner = dom.container.querySelectorAll('div').find(element => element.childNodes.includes(stepper)); assert.ok(owner);
				await act(async () => reactProps(owner).onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false } }));
			}
			assert.deepEqual(writes, [{ edge: 'minimum', frequency: 500 }, { edge: 'maximum', frequency: 12_000 }]);
			assert.deepEqual(fields.map(field => field.value), ['500', '12000']);
		} finally {
			await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
		}
	});
}
