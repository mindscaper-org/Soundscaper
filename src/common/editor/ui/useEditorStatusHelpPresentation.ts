/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useEffectEvent, useSyncExternalStore, type RefObject } from 'react';
import { selectAudioEditorBusyBlock, type AudioEditorEditBlockingSnapshot } from '../edit-blocking.ts';
import { useEditorStatusHelp, useEditorStatusHelpEnabled } from './EditorStatusHelpProvider.tsx';
import { editorStatusHelp, statusHelpTransportCue, type StatusHelpMenu } from './editor-status-help.ts';

const EMPTY = Object.freeze({ enabled: false, text: null, backgrounded: false });
const emptySnapshot = () => EMPTY;
const noSubscription = () => () => undefined;
interface StatusSnapshot extends AudioEditorEditBlockingSnapshot {
	readonly ready?: boolean;
	readonly playbackOptions?: Readonly<{ preparing?: unknown; rate?: number }>;
}
interface Controller {
	subscribeTelemetry?(listener: () => void): () => void;
	getTelemetrySnapshot?(): { readonly transportState?: string };
}

export function useEditorStatusHelpPresentation({ rootRef, copy, menus, controller, snapshot, statusMessage, showStatusbar, locale }: {
	readonly rootRef: RefObject<HTMLElement | null>;
	readonly copy: Readonly<Record<string, string>>;
	readonly menus: readonly StatusHelpMenu[];
	readonly controller: Controller;
	readonly snapshot: StatusSnapshot;
	readonly statusMessage: string;
	readonly showStatusbar: boolean;
	readonly locale: string;
}) {
	const session = useEditorStatusHelp();
	const enabled = useEditorStatusHelpEnabled();
	const presentation = useSyncExternalStore(session?.subscribe ?? noSubscription, session?.getSnapshot ?? emptySnapshot, session?.getSnapshot ?? emptySnapshot);
	const readTransport = useCallback(() => controller.getTelemetrySnapshot?.().transportState ?? 'stopped', [controller]);
	const transportState = useSyncExternalStore(controller.subscribeTelemetry ?? noSubscription, readTransport, readTransport);
	const resolve = useEffectEvent((target: Element | null) => {
		const root = rootRef.current?.closest<HTMLElement>('[data-audio-editor]');
		return root ? editorStatusHelp(target, root, copy, menus) : null;
	});
	useEffect(() => {
		const root = rootRef.current?.closest<HTMLElement>('[data-audio-editor]');
		if (root && enabled && showStatusbar) return session?.attach(root, resolve);
	}, [session, enabled, showStatusbar, rootRef]);
	const priorityStatus = selectAudioEditorBusyBlock(snapshot).blocked || snapshot.readOnly || snapshot.lockReadOnly || snapshot.ready === false;
	return {
		contextual: enabled && showStatusbar,
		instructionText: enabled && showStatusbar ? presentation.text ?? copy.timelineHint : copy.timelineHint,
		backgrounded: enabled && presentation.backgrounded,
		statusMessage: enabled && showStatusbar && !priorityStatus
			? statusHelpTransportCue(transportState, snapshot.playbackOptions?.rate ?? 1, Boolean(snapshot.recording), copy, locale)
			: statusMessage,
	};
}
