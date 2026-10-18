/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';
import type { ProjectRecoverySummary } from '../../storage/project-recovery-repository.ts';
import type { ProjectRecoveryUiActions, ProjectRecoveryUiInspection } from './project-recovery-model.ts';

interface Props {
	readonly actions: ProjectRecoveryUiActions;
	readonly initialProjectId?: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

/** Inspection is read-only; publication requires the exact candidate the user reviewed. */
export default function ProjectRecoveryDialog({ actions, initialProjectId = '', copy, run, onClose }: Props) {
	const [projects, setProjects] = useState<readonly ProjectRecoverySummary[]>([]);
	const [projectId, setProjectId] = useState(initialProjectId);
	const [inspection, setInspection] = useState<ProjectRecoveryUiInspection | null>(null);
	const [candidateIndex, setCandidateIndex] = useState(0);
	const [loading, setLoading] = useState(true);
	const [recovering, setRecovering] = useState(false);
	const [error, setError] = usePresentationFeedback(copy);
	const admission = useRef(false);
	useEffect(() => {
		let current = true;
		void actions.list().then((rows) => {
			if (!current) return;
			setProjects(rows);
			setProjectId((id) => id || rows[0]?.id || '');
			setLoading(false);
		}).catch((failure: unknown) => { if (current) { setError(feedbackFailure(failure)); setLoading(false); } });
		return () => { current = false; };
	}, [actions, setError]);
	useEffect(() => {
		if (!projectId) return;
		let current = true;
		setLoading(true);
		setInspection(null);
		setError('');
		void actions.inspect(projectId).then((value) => {
			if (!current) return;
			setInspection(value);
			setCandidateIndex(Math.max(0, value.candidates.findIndex((candidate) => candidate.status !== 'unrecoverable')));
		}).catch((failure: unknown) => { if (current) setError(feedbackFailure(failure)); })
			.finally(() => { if (current) setLoading(false); });
		return () => { current = false; };
	}, [actions, projectId, setError]);
	const candidate = inspection?.candidates[candidateIndex];
	const recover = (): void => {
		if (admission.current || loading || !inspection || !candidate || candidate.status === 'unrecoverable') return;
		admission.current = true;
		setRecovering(true);
		setError('');
		void runAwaitedAudioEditorOperation(run, () => actions.recover(inspection, candidateIndex))
			.then(onClose)
			.catch((failure: unknown) => { setError(feedbackFailure(failure)); })
			.finally(() => { admission.current = false; setRecovering(false); });
	};
	const candidateLabel = (value: NonNullable<typeof candidate>): string => [
		value.kind === 'current' ? copy.projectRecoveryCurrent : copy.projectRecoveryRevision.replace('{revision}', String(value.revision ?? '?')),
		value.status === 'usable' ? copy.projectRecoveryUsable : value.status === 'repairable' ? copy.projectRecoveryRepairable : copy.projectRecoveryUnrecoverable,
	].join(' — ');
	return <AudioEditorDialogShell title={copy.projectRecoveryTitle} onClose={onClose}
		ariaDescribedBy="project-recovery-description" dataAttributes={{ 'data-project-recovery-dialog': 'true' }} width={640}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" disabled={recovering} onClick={onClose}>{copy.close}</Button>
			<Button variant="primary" disabled={loading || recovering || !candidate || candidate.status === 'unrecoverable'} onClick={recover}>
				{recovering ? copy.projectRecoveryCreating : copy.projectRecoveryCreate}
			</Button>
		</>} />}
	>
		<p id="project-recovery-description">{copy.projectRecoveryDescription}</p>
		{projects.length > 0 ? <>
			<label>{copy.projectRecoveryProject}
				<select value={projectId} disabled={recovering} onChange={(event) => setProjectId(event.currentTarget.value)}>
					{projects.map((value) => <option key={value.id} value={value.id}>{value.title}</option>)}
				</select>
			</label>
			{inspection && inspection.candidates.length > 0 ? <>
				<label>{copy.projectRecoveryVersion}
					<select value={candidateIndex} disabled={recovering} onChange={(event) => setCandidateIndex(Number(event.currentTarget.value))}>
						{inspection.candidates.map((value, index) => <option key={value.key} value={index}>{candidateLabel(value)}</option>)}
					</select>
				</label>
				{candidate?.changes.length ? <>
					<h3>{copy.projectRecoveryChanges}</h3>
					<ul>{candidate.changes.map((change, index) => <li key={index}>{change.path}: {change.reason}</li>)}</ul>
				</> : candidate?.status === 'usable' ? <p>{copy.projectRecoveryNoChanges}</p> : null}
				{candidate?.error && <p role="alert">{candidate.error}</p>}
			</> : !loading && <p>{copy.projectRecoveryNoVersions}</p>}
		</> : !loading && <p>{copy.projectRecoveryEmpty}</p>}
		<p role="status" aria-live="polite">{error || (loading ? copy.projectRecoveryInspecting : '')}</p>
	</AudioEditorDialogShell>;
}
