/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { Toast } from '@soundscaper/design-system/Toast/Toast';
import { useEditorNotifications } from './EditorNotificationProvider.tsx';
import { useToastReadingTime } from './useToastReadingTime.ts';

export interface EditorToastAction {
	readonly label: string;
	readonly onClick: () => void;
	readonly disabled?: boolean;
	readonly href?: string;
}

export interface EditorToastProps {
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly timer?: string;
	readonly type?: 'info' | 'warning' | 'error' | 'success';
	readonly icon?: ReactNode;
	readonly actions?: readonly EditorToastAction[];
	readonly dismissLabel?: string;
	readonly onDismiss?: () => void;
	readonly persistent?: boolean;
	readonly progress?: number;
	readonly progressContent?: ReactNode;
}

/** Controlled notifications stay within the editor that owns their state. */
export default function EditorToast({
	id, title, description, timer, type = 'info', icon, actions = [], dismissLabel, onDismiss, persistent = false, progress, progressContent,
}: EditorToastProps) {
	const session = useEditorNotifications();
	const instance = useId();
	const hasProgress = progress !== undefined || Boolean(progressContent);
	const important = type === 'error' || persistent || actions.length > 0 || hasProgress;
	const [admitted] = useState(() => session?.shouldShow({ type, actionable: actions.length > 0, progress: hasProgress, persistent }) ?? true);
	const visible = admitted || important;
	const timed = visible && !important && Boolean(onDismiss);
	const readingTime = useToastReadingTime(id, timed, onDismiss);
	useEffect(() => {
		if (!hasProgress) session?.record({ key: `${instance}:${id}`, title, description, type });
	}, [session, instance, id, title, description, type, hasProgress]);
	if (!visible) return null;

	return <section className="kw-audio-editor__toast" aria-label={title} data-editor-toast={id}
		data-timed={timed || undefined} data-actionable={actions.length > 0 || hasProgress || undefined} {...readingTime}>
		<Toast id={id} type={type} icon={icon} title={title} description={description} showCloseButton={false}
			progress={progress} showProgress={progress !== undefined} timeRemaining={progress !== undefined ? description : undefined} />
		{progressContent && <div className="kw-audio-editor__toast-detail">{progressContent}</div>}
		{timer && <div className="kw-audio-editor__toast-detail" role="timer" aria-live="off">{timer}</div>}
		{!persistent && onDismiss && <Button className="kw-audio-editor__toast-close" onClick={(event) => {
			event?.currentTarget.closest('[data-audio-editor]')?.querySelector<HTMLElement>('[data-chrome-drawer-toggle], [role="menuitem"]')?.focus({ preventScroll: true });
			onDismiss();
		}}><span aria-hidden="true">×</span><span className="kw-audio-editor-sr-only">{dismissLabel}</span></Button>}
		<div className="kw-audio-editor__toast-actions">
			{actions.map((action) => action.href ? <a key={action.label} href={action.href}
				onClick={(event) => { event.preventDefault(); action.onClick(); }}>{action.label}</a> : <Button
				key={action.label}
				disabled={action.disabled}
				onClick={action.onClick}
			>{action.label}</Button>)}
		</div>
	</section>;
}

/** Mount while the warning applies; mounting again starts a new notification. */
export function EditorWarningToast(props: Omit<EditorToastProps, 'onDismiss' | 'type'>) {
	const [dismissed, setDismissed] = useState(false);
	if (dismissed) return null;
	return <EditorToast {...props} type="warning" onDismiss={() => setDismissed(true)} />;
}

/** A locally dismissible error that remounts when its owning condition returns. */
export function EditorErrorToast(props: Omit<EditorToastProps, 'onDismiss' | 'type'>) {
	const [dismissed, setDismissed] = useState(false);
	if (dismissed) return null;
	return <EditorToast {...props} type="error" onDismiss={() => setDismissed(true)} />;
}
