/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer/Footer';
import { LabeledCheckbox } from '@soundscaper/design-system/LabeledCheckbox/LabeledCheckbox';
import type { EditorNotificationSession } from '../../controller/composition/editor-notification-session.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

interface Props {
	readonly session: EditorNotificationSession;
	readonly snapshot: ReturnType<EditorNotificationSession['getSnapshot']>;
	readonly copy: Readonly<Record<string, string>>;
}

export default function EditorNotificationHistory({ session, snapshot, copy }: Props) {
	const close = () => session.setHistoryOpen(false);
	return <AudioEditorDialogShell title={copy.notificationHistory ?? ''} onClose={close} width={520}
		footer={<DialogFooter rightContent={<><Button disabled={!snapshot.history.length} onClick={() => session.clear()}>{copy.notificationClear}</Button>
			<Button onClick={close}>{copy.close}</Button></>} />}>
		<p>{copy.notificationHistoryNote}</p>
		<LabeledCheckbox label={copy.notificationMute ?? ''} checked={snapshot.muted} onChange={muted => session.setMuted(muted)} />
		{snapshot.history.length ? <ol className="kw-editor-notification-history">{snapshot.history.map(entry => <li key={entry.key}>
			<strong>{entry.title}</strong>{entry.description && <p>{entry.description}</p>}
		</li>)}</ol> : <p>{copy.notificationEmpty}</p>}
	</AudioEditorDialogShell>;
}
