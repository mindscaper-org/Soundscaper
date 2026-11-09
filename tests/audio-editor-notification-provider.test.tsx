/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import EditorToast from '../src/common/editor/ui/EditorToast.tsx';
import { EditorNotificationProvider, useEditorNotifications } from '../src/common/editor/ui/EditorNotificationProvider.tsx';
import type { EditorNotificationSession } from '../src/common/editor/controller/composition/editor-notification-session.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('the editor provider archives muted arrivals and keeps active and critical notifications visible', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let session: EditorNotificationSession | null = null;
	function ReadSession() { session = useEditorNotifications(); return null; }
	const render = async (id: string, type: 'info' | 'error' = 'info') => {
		await act(async () => root.render(<EditorNotificationProvider><ReadSession />
			<EditorToast key={id} id={id} title={id} type={type} onDismiss={() => undefined} />
		</EditorNotificationProvider>));
	};
	try {
		await render('already-visible');
		const notifications = session as EditorNotificationSession | null;
		assert.ok(notifications);
		await act(async () => { notifications.setMuted(true); });
		assert.ok(dom.find('[data-editor-toast="already-visible"]'), 'mute does not remove a notice being read');
		await render('muted-arrival');
		assert.equal(dom.find('[data-editor-toast="muted-arrival"]'), null);
		assert.deepEqual(notifications.getSnapshot().history.map(entry => entry.title), ['muted-arrival', 'already-visible']);
		await render('critical', 'error');
		assert.ok(dom.find('[data-editor-toast="critical"]'));
		await act(async () => { notifications.clear(); });
		assert.equal(notifications.getSnapshot().history.length, 0);
		assert.ok(dom.find('[data-editor-toast="critical"]'), 'clearing history does not dismiss an active error');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = prior;
		dom.restore();
	}
});
