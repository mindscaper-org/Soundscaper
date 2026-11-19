/* SPDX-License-Identifier: AGPL-3.0-only */

import { createContext, Suspense, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createEditorNotificationSession, EMPTY_NOTIFICATION_SNAPSHOT, type EditorNotificationSession } from '../controller/composition/editor-notification-session.ts';
import { lazyEditorModule } from '../../offline/lazy-module.tsx';

const NotificationContext = /* @__PURE__ */ createContext<EditorNotificationSession | null>(null);
const NotificationHistory = lazyEditorModule(() => import('./dialogs/EditorNotificationHistory.tsx'));
const subscribeEmpty = () => () => undefined;
const emptySnapshot = () => EMPTY_NOTIFICATION_SNAPSHOT;

export function useEditorNotifications() { return useContext(NotificationContext); }

export function useEditorNotificationSnapshot() {
	const session = useEditorNotifications();
	return useSyncExternalStore(session?.subscribe ?? subscribeEmpty, session?.getSnapshot ?? emptySnapshot, session?.getSnapshot ?? emptySnapshot);
}

export function EditorNotificationProvider({ children }: { readonly children: ReactNode }) {
	const [session] = useState(createEditorNotificationSession);
	return <NotificationContext.Provider value={session}>{children}</NotificationContext.Provider>;
}

export function EditorNotificationSurfaces({ copy }: { readonly copy: Readonly<Record<string, string>> }) {
	const session = useEditorNotifications();
	const snapshot = useEditorNotificationSnapshot();
	return snapshot.historyOpen && session ? <Suspense fallback={null}>
		<NotificationHistory session={session} snapshot={snapshot} copy={copy} />
	</Suspense> : null;
}
