/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { TimeCode } from '../vendor/audacity-design-system/components/src/TimeCode/TimeCode.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('opted-in clocks distinguish explicit signed entry from ordinary magnitude edits', async () => {
	const dom = installReactTestDom();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const textEntries: unknown[] = [];
	const magnitudeEdits: number[] = [];
	try {
		await act(async () => root.render(<TimeCode value={2} format="hh:mm:ss+frames" frameRate={24} onChange={(value) => magnitudeEdits.push(value)} onTextChange={(magnitude, sign) => textEntries.push([magnitude, sign])} />));
		for (const [entry, expected] of [['+1', [1, '+']], ['-00:00:01:00', [1, '-']], ['1', [1, null]]] as const) {
			await act(async () => reactProps(dom.one('.timecode__display')).onDoubleClick?.({ preventDefault() {}, stopPropagation() {} }));
			const input = dom.one('.timecode__free-text');
			await act(async () => reactProps(input).onChange?.({ currentTarget: { value: entry } }));
			assert.equal(input.getAttribute('aria-invalid'), 'false');
			await act(async () => reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} }));
			assert.deepEqual(textEntries.at(-1), expected);
		}
		assert.deepEqual(magnitudeEdits, [], 'signed text entries do not invoke the magnitude-only path');
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('the main sequence clock seeks explicitly across zero while retaining unsigned magnitude edits', async () => {
	const { default: TelemetryTimeCode } = await import('../src/common/editor/ui/toolbar/TelemetryTimeCode.tsx');
	const { ENGLISH_COPY } = await import('../src/common/i18n/catalogs.js');
	const dom = installReactTestDom();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const telemetry = { positionFrame: 0 };
	const labels: string[] = [];
	try {
		await act(async () => root.render(<TelemetryTimeCode copy={ENGLISH_COPY} durationFrames={480000} sequenceTiming={true} project={{ sampleRate: 48000, primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 24, den: 1 }, dropFrame: false, startTimecode: { negative: true, hours: 0, minutes: 0, seconds: 2, frames: 0 } }] }} controller={{ getTelemetrySnapshot: () => telemetry, subscribeTelemetry: () => () => undefined, actions: { sequences: { seekLabel: (label) => labels.push(label) } } }} run={(operation) => operation()} />));
		for (const text of ['+1', '-00:00:01:00', '1']) {
			await act(async () => reactProps(dom.one('.timecode__display')).onDoubleClick?.());
			const input = dom.one('.timecode__free-text');
			await act(async () => reactProps(input).onChange?.({ currentTarget: { value: text } }));
			await act(async () => reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} }));
		}
		assert.deepEqual(labels, ['00:00:01:00', '-00:00:01:00', '-00:00:01:00']);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
