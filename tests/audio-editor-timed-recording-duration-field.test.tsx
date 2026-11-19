/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TimedRecordingDialogFields from '../src/common/editor/ui/dialogs/TimedRecordingDialogFields.tsx';
import { createTimedRecordingDialogValue, timedRecordingDialogRange } from '../src/common/editor/ui/dialogs/timed-recording-dialog-model.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Timed Recording Duration displays the subsecond interval entered as an end time', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const start = Date.now() + 60_000;
	const initial = createTimedRecordingDialogValue(start, start + 250);
	const requests: unknown[] = [];
	function Dialog() {
		const [value, setValue] = useState({ ...initial, endMode: 'end' as const } as ReturnType<typeof createTimedRecordingDialogValue>);
		return <TimedRecordingDialogFields value={value} onValueChange={setValue}
			onSubmit={() => { requests.push(timedRecordingDialogRange(value)); }} copy={ENGLISH_COPY} locale="en" />;
	}
	try {
		await act(async () => root.render(<Dialog />));
		const durationMode = dom.container.querySelectorAll('input').find(input => input.value === 'duration');
		assert.ok(durationMode);
		await act(async () => reactProps(durationMode).onChange());
		const duration = dom.one('[data-timecode-direct-entry]');
		assert.equal(duration.value, '0.25');
		await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
		assert.deepEqual(requests, [{ startTimeMs: start, endTimeMs: start + 250 }]);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
