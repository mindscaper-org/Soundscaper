/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';
import { createAudacityRecoverySelection, type AudacityRecoveryFiles } from '../../controller/document/audacity-recovery-selection.ts';
import type { AudacityRecoveryInspection } from '../../audacity-recovery-inspection.ts';
import AudacityRecoveryAssessment from './AudacityRecoveryAssessment.tsx';
import EditorControlLabel from '../EditorControlLabel.tsx';

interface Props {
	readonly fileService: AudacityRecoveryFiles;
	readonly open: (file: File, options: { recover: true }) => unknown;
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

export default function AudacityRecoveryDialog({ fileService, open, copy, run, onClose }: Props) {
	const selectionRef = useRef<ReturnType<typeof createAudacityRecoverySelection> | null>(null);
	const selection = () => selectionRef.current ??= createAudacityRecoverySelection(fileService);
	const [name, setName] = useState('');
	const [inspection, setInspection] = useState<AudacityRecoveryInspection | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = usePresentationFeedback(copy);
	const admission = useRef(false);
	useEffect(() => () => {
		const current = selectionRef.current; selectionRef.current = null;
		if (current) void current.dispose().catch(() => undefined);
	}, []);
	const perform = (operation: () => Promise<unknown>): void => {
		if (admission.current) return;
		admission.current = true;
		setPending(true);
		setError('');
		void runAwaitedAudioEditorOperation(run, operation)
			.catch((failure: unknown) => setError(feedbackFailure(failure)))
			.finally(() => { admission.current = false; setPending(false); });
	};
	const inspect = async (): Promise<void> => { setInspection(null); setInspection(await selection().inspect()); };
	const choose = (): void => perform(async () => { const selected = await selection().choose(); if (selected) { setName(selected); await inspect(); } });
	const setFile = (file: File): void => perform(async () => { setName(await selection().setFile(file)); await inspect(); });
	return <AudioEditorDialogShell title={copy.recoverAudacityProjectTitle} onClose={pending ? undefined : onClose}
		ariaDescribedBy="audacity-recovery-description" width={560}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" disabled={pending} onClick={onClose}>{copy.close}</Button>
			<Button variant="secondary" disabled={pending || !inspection?.canRepair} onClick={() => perform(async () => { if (await selection().saveCopy()) onClose(); })}>{copy.recoverAudacityNativeCopy}</Button>
			<Button variant="primary" disabled={pending || !name} onClick={() => perform(async () => { await selection().recover(open); onClose(); })}>
				{pending ? copy.projectRecoveryCreating : copy.recoverAudacityProjectAction}
			</Button>
		</>} />}
	>
		<p id="audacity-recovery-description">{copy.recoverAudacityProjectDescription}</p>
		{fileService.isDesktop ? <Button variant="secondary" disabled={pending} onClick={choose}>{copy.recoverAudacityProjectFile}</Button>
			: <label><EditorControlLabel>{copy.recoverAudacityProjectFile}</EditorControlLabel><input type="file" accept=".aup3,.aup4,.aup4unsaved"
				disabled={pending} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) setFile(file); }} /></label>}
		{name && <p>{name}</p>}
		{inspection && <AudacityRecoveryAssessment inspection={inspection} copy={copy} />}
		<p role="status" aria-live="polite">{error}</p>
	</AudioEditorDialogShell>;
}
