/* SPDX-License-Identifier: AGPL-3.0-only */

export interface EditorNotificationRecord {
	readonly key: string;
	readonly title: string;
	readonly description?: string;
	readonly type: 'info' | 'warning' | 'error' | 'success';
}

interface NotificationVisibility {
	readonly type: EditorNotificationRecord['type'];
	readonly actionable?: boolean;
	readonly progress?: boolean;
	readonly persistent?: boolean;
}

interface NotificationSnapshot {
	readonly history: readonly EditorNotificationRecord[];
	readonly muted: boolean;
	readonly historyOpen: boolean;
}

export const EMPTY_NOTIFICATION_SNAPSHOT: NotificationSnapshot = Object.freeze({
	history: Object.freeze([]), muted: false, historyOpen: false,
});

/** One mounted editor owns its history. Never retain project commands in it. */
export function createEditorNotificationSession() {
	let snapshot = EMPTY_NOTIFICATION_SNAPSHOT;
	const listeners = new Set<() => void>();
	const publish = (next: typeof snapshot) => {
		snapshot = Object.freeze(next);
		for (const listener of listeners) listener();
	};
	return {
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		record(input: EditorNotificationRecord) {
			const previous = snapshot.history.find(entry => entry.key === input.key);
			if (previous?.title === input.title && previous.description === input.description && previous.type === input.type) return;
			const record = Object.freeze({ key: input.key, title: input.title, type: input.type,
				...(input.description === undefined ? {} : { description: input.description }) });
			publish({ ...snapshot, history: Object.freeze([record, ...snapshot.history.filter(entry => entry.key !== input.key)].slice(0, 100)) });
		},
		clear() { if (snapshot.history.length) publish({ ...snapshot, history: Object.freeze([]) }); },
		setMuted(muted: boolean) { if (muted !== snapshot.muted) publish({ ...snapshot, muted }); },
		setHistoryOpen(historyOpen: boolean) { if (historyOpen !== snapshot.historyOpen) publish({ ...snapshot, historyOpen }); },
		shouldShow(input: NotificationVisibility) {
			return !snapshot.muted || input.type === 'error' || Boolean(input.actionable || input.progress || input.persistent);
		},
	};
}

export type EditorNotificationSession = ReturnType<typeof createEditorNotificationSession>;
