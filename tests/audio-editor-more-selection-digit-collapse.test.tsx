/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { selectionControllerCustody, selectionWav } from './helpers/selection-controller-custody.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';

test('sample digit replacement crosses collapsed endpoints through the real controller and durable one-sample loop', async context => {
	const f = await selectionControllerCustody(context, selectionWav('sample edit.wav', 48_000, 2, 48_000));
	const control = (index: number) => { const node = f.fixture.dom.container.querySelectorAll('.timecode')[index]; assert.ok(node); return node; };
	const samples = async (index: number) => {
		if (control(index).querySelectorAll('.timecode-digit').length === 12) return;
		const trigger = control(index).querySelector('.timecode__format-button'); assert.ok(trigger);
		await act(async () => { reactProps(trigger).onClick(); });
		const item = f.fixture.dom.container.querySelectorAll('[role="menuitem"]').find(node => node.textContent === 'samples'); assert.ok(item);
		await act(async () => { reactProps(item).onClick({ stopPropagation() {} }); });
	};
	const digits = (index: number) => control(index).querySelectorAll('.timecode-digit');
	try {
		f.controller.actions.timeline.setSelection(24_001, 48_000);
		await f.toolbar();
		await samples(1);
		const digit = digits(1)[7]; assert.ok(digit); digit.focus();
		await act(async () => { reactProps(digit).onClick(); });
		for (const key of '24002') await f.key(key);
		assert.deepEqual([f.controller.getSnapshot().selection?.startFrame, f.controller.getSnapshot().selection?.endFrame], [24_001, 24_002]);
		const last = digits(1).at(-1); assert.ok(last); last.focus();
		await act(async () => { reactProps(last).onClick(); });
		await f.key('1');
		assert.equal(f.controller.getSnapshot().selection, null, 'intentional endpoint collapse remains a cursor');
		await f.commitDigit(last);
		await f.key('9');
		assert.equal(f.controller.getSnapshot().selection, null, 'Enter retires the collapsed editing draft');
		await act(async () => { f.controller.actions.timeline.selectAll(); });
		for (const [index, frame] of [[0, 24_001], [1, 24_002]] as const) {
			await samples(index);
			const first = digits(index)[0]; assert.ok(first); first.focus();
			await act(async () => { reactProps(first).onClick(); });
			for (const key of String(frame).padStart(12, '0')) await f.key(key);
			await f.commitDigit(first);
			assert.deepEqual(digits(index).map(node => node.textContent), [...String(frame).padStart(12, '0')]);
		}
		assert.deepEqual([f.controller.getSnapshot().selection?.startFrame, f.controller.getSnapshot().selection?.endFrame], [24_001, 24_002]);
		await act(async () => { await f.controller.actions.transport.loopToSelection(); });
		const current = clipboardProject(f.controller.project);
		assert.deepEqual([current.loop.startFrame, current.loop.endFrame, current.loop.enabled], [24_001, 24_002, true]);
		assert.equal(current.clips.length, 1); assert.equal(current.sources.length, 1);
		assert.deepEqual([current.clips[0]?.durationFrames, current.sources[0]?.frameCount, current.sources[0]?.channelCount], [48_000, 48_000, 2]);
		const reopened = await f.archive(); assert.deepEqual(reopened, f.controller.project);
	} finally { await f.dispose(); }
});
