/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import type { AssistanceGuidedWorkflowId } from '../../assistance/workflow-recipes.ts';
import type { LocalAssistanceGuidedSnapshot } from '../local-assistance-guided-session-store.ts';
import type { LocalAssistanceSnapshot } from '../local-assistance-session-types.ts';
import { assistanceTaskLabel } from '../assistance-task-catalog.ts';
import { assistanceTaskModelsReady } from '../../controller/assistance/local-assistance-task-models.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import AssistanceProcessingProgress from './AssistanceProcessingProgress.tsx';

/** A menu command needs progress and cancellation, without a configuration step. */
export default function LocalAssistanceTaskProcessingDialog({ workflowId, inventory, snapshot, error, copy, onClose }: {
	readonly workflowId: AssistanceGuidedWorkflowId;
	readonly inventory: LocalAssistanceSnapshot;
	readonly snapshot: LocalAssistanceGuidedSnapshot;
	readonly error: string | null;
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly onClose: () => void;
}) {
	const failed = error || snapshot.error || inventory.error;
	const loading = inventory.phase === 'idle' || inventory.phase === 'loading';
	const missingModels = !loading && snapshot.settings !== null
		&& !assistanceTaskModelsReady(snapshot.settings, inventory.models, inventory.sources);
	const unavailable = !loading && (inventory.sources.length === 0 || missingModels
		|| inventory.phase === 'unavailable' || snapshot.phase === 'unavailable');
	const message = failed || (missingModels ? copy.assistanceModelsMissing || 'Required models are missing. Open Model Manager to install them.'
		: unavailable ? copy.localAssistanceWorkflowPreparationUnavailable || 'This task is unavailable for the selected media.'
		: snapshot.phase === 'cancelled' ? copy.localAssistanceCancelled || 'Processing cancelled.'
			: copy.assistanceProcessingStatus || 'Processing status');
	const busy = !failed && !unavailable && !['cancelled', 'accepted', 'review-ready', 'error'].includes(snapshot.phase);
	return <AudioEditorDialogShell title={assistanceTaskLabel(workflowId, copy)} onClose={onClose}
		width={560} initialFocus="dialog" dataAttributes={{ 'data-local-assistance': 'true' }}
		footer={<DialogFooter rightContent={<Button variant="secondary" onClick={onClose}>
			{busy ? copy.cancel || 'Cancel' : copy.close || 'Close'}</Button>} />}>
		<p role={failed || unavailable ? 'alert' : 'status'} aria-live="polite">{message}</p>
		{busy && <AssistanceProcessingProgress label={copy.assistanceProcessingStatus || 'Processing status'}
			progress={snapshot.progress} />}
	</AudioEditorDialogShell>;
}
