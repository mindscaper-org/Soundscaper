/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEditorNotifications, useEditorNotificationSnapshot } from './EditorNotificationProvider.tsx';
import { useEditorStatusHelp, useEditorStatusHelpEnabled } from './EditorStatusHelpProvider.tsx';

interface Menu { readonly id: string; readonly items?: readonly unknown[] }

/** Shared application menus feed browser, search and native desktop menus. */
export function useEditorFeedbackMenus<Entry extends Menu>(menus: Entry[], copy: Readonly<Record<string, string>>): Entry[] {
	const session = useEditorNotifications();
	const snapshot = useEditorNotificationSnapshot();
	const statusHelp = useEditorStatusHelp();
	const statusHelpEnabled = useEditorStatusHelpEnabled();
	if (!session) return menus;
	return menus.map(menu => menu.id === 'view' ? { ...menu, items: [...(menu.items ?? []),
		...(statusHelp ? [{ id: 'editor-status-help', label: copy.statusHelpEnabled, checked: statusHelpEnabled,
			onClick: () => statusHelp.setEnabled(!statusHelp.getEnabled()) }] : []), {
		id: 'editor-notifications', label: copy.notificationHistory,
		items: [
			{ id: 'editor-notification-history', label: copy.notificationHistoryOpen, onClick: () => session.setHistoryOpen(true) },
			{ id: 'editor-notifications-muted', label: copy.notificationMute, checked: snapshot.muted,
				onClick: () => session.setMuted(!session.getSnapshot().muted) },
		],
	}] } : menu);
}
