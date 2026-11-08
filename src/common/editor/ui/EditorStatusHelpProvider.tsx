/* SPDX-License-Identifier: AGPL-3.0-only */

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createStatusHelpSession } from '../controller/composition/status-help-session.ts';

const EMPTY = createStatusHelpSession();
const StatusHelpContext = /* @__PURE__ */ createContext<ReturnType<typeof createStatusHelpSession> | null>(null);

export function EditorStatusHelpProvider({ children }: { readonly children: ReactNode }) {
	const [session] = useState(createStatusHelpSession);
	return <StatusHelpContext.Provider value={session}>{children}</StatusHelpContext.Provider>;
}

export function useEditorStatusHelp() { return useContext(StatusHelpContext); }

export function useEditorStatusHelpEnabled() {
	const session = useEditorStatusHelp() ?? EMPTY;
	return useSyncExternalStore(session.subscribe, session.getEnabled, session.getEnabled);
}
