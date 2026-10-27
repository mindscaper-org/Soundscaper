/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AudioEditorTimeCodeInput from '../src/common/editor/ui/AudioEditorTimeCodeInput.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('sample precision hold-time entry commits a representable millisecond value and restores rejected commits', async () => {
	const dom = installReactTestDom();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const committed: number[] = [];
	try {
		await act(async () => root.render(<AudioEditorTimeCodeInput label="Hold after silence" unit="milliseconds" value={250} quantum={1} onCommit={(value) => { committed.push(value); return false; }} />));
		const field = dom.one('[data-timecode-direct-entry="true"]');
		await act(async () => reactProps(field).onChange?.({ currentTarget: { valueAsNumber: 1000 / 48000 } }));
		assert.equal(field.value, '0', 'the field shows its rounded, storable value');
		const wrapper = dom.one('.audio-editor-timecode-input');
		await act(async () => reactProps(wrapper).onBlur?.({ currentTarget: wrapper, relatedTarget: null }));
		assert.deepEqual(committed, [0]);
		assert.equal(field.value, '250', 'a refusal restores the committed preference');
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
