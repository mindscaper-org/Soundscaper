/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';

interface Props {
	readonly open: (file: File, options: { recover: true }) => unknown;
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

export default function AudacityRecoveryDialog({ open, copy, run, onClose }: Props) {
	const [file, setFile] = useState<File | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = usePresentationFeedback(copy);
	const admission = useRef(false);
	const recover = (): void => {
		if (!file || admission.current) return;
		admission.current = true;
		setPending(true);
		setError('');
		void runAwaitedAudioEditorOperation(run, () => open(file, { recover: true }))
			.then(onClose)
			.catch((failure: unknown) => setError(feedbackFailure(failure)))
			.finally(() => { admission.current = false; setPending(false); });
	};
	return <AudioEditorDialogShell title={copy.recoverAudacityProjectTitle} onClose={onClose}
		ariaDescribedBy="audacity-recovery-description" width={560}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" disabled={pending} onClick={onClose}>{copy.close}</Button>
			<Button variant="primary" disabled={pending || !file} onClick={recover}>
				{pending ? copy.projectRecoveryCreating : copy.recoverAudacityProjectAction}
			</Button>
		</>} />}
	>
		<p id="audacity-recovery-description">{copy.recoverAudacityProjectDescription}</p>
		<label>{copy.recoverAudacityProjectFile}<input type="file" accept=".aup3,.aup4"
			disabled={pending} onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} /></label>
		<p role="status" aria-live="polite">{error}</p>
	</AudioEditorDialogShell>;
}
