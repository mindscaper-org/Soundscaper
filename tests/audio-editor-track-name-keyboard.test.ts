/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { beginTrackNameRename } from '../src/common/editor/ui/timeline/track-name-keyboard.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('Enter and F2 open the adapter-owned rename editor only from an admitted name button', () => {
	const dom = installReactTestDom();
	try {
		const name = dom.container.ownerDocument.createElement('span');
		name.setAttribute('class', 'track-control-panel__track-name-text');
		let opened = 0;
		for (const key of ['Enter', 'F2']) {
			let prevented = false, stopped = false;
			const event = { key, target: name as unknown as EventTarget, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
			assert.equal(beginTrackNameRename(event, false, () => opened++), true);
			assert.equal(prevented && stopped, true);
			assert.equal(beginTrackNameRename(event, true, () => opened++), false);
			assert.equal(beginTrackNameRename({ ...event, target: dom.container as unknown as EventTarget }, false, () => opened++), false);
			assert.equal(beginTrackNameRename({ ...event, nativeEvent: { isComposing: true } }, false, () => opened++), false);
		}
		assert.equal(opened, 2);
	} finally { dom.restore(); }
});
