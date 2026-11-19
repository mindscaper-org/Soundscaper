/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useState } from 'react';
import { resolveLocalAssistanceBridge } from '../../assistance/local-assistance-bridge.ts';
import { defaultAssistanceWorkflowSettingsV1 } from '../../assistance/workflow-settings-v1.ts';
import { assistanceTaskAvailableModelFilter, assistanceTaskModelsReady } from '../../controller/assistance/local-assistance-task-models.ts';
import { generateProjectTranscripts } from '../../controller/assistance/transcript-generation-session.ts';
import type { TranscriptGenerationTarget } from '../../transcript-editing.ts';
import { createLocalAssistanceGuidedSessionStore } from '../local-assistance-guided-session-store.ts';
import { assistanceTaskSettingsForModels } from '../local-assistance-task-controls.ts';
import { resolveLocalModelManagerBridge } from '../local-model-manager-availability.ts';
import type { LocalModelManagerModel } from '../local-model-manager-bridge.ts';
import AssistanceModelGate from '../dialogs/AssistanceModelGate.tsx';
import type { TranscriptPanelController } from './transcript-editing-panel-types.ts';

interface Props {
	readonly controller: TranscriptPanelController;
	readonly targets: readonly TranscriptGenerationTarget[];
	readonly bridgeScope: unknown;
	readonly copy: Readonly<Record<string, string>>;
	readonly locale: string;
	readonly signal: AbortSignal;
	onProgress(completed: number, total: number): void;
	onDone(error?: unknown): void;
	onClose(): void;
}

const SETTINGS = defaultAssistanceWorkflowSettingsV1('transcribe-captions');
const MODEL_FILTER = assistanceTaskAvailableModelFilter(SETTINGS);
const modelsReady = (models: readonly LocalModelManagerModel[]) => assistanceTaskModelsReady(
	assistanceTaskSettingsForModels(SETTINGS, models), models, [],
);

export default function TranscriptGeneration(props: Props) {
	const modelBridge = useMemo(() => resolveLocalModelManagerBridge(props.bridgeScope), [props.bridgeScope]);
	return <AssistanceModelGate title={props.copy['ui.transcriptEditing.title'] || 'Transcript-based editing'}
		copy={props.copy} locale={props.locale} bridge={modelBridge} requiresModel modelFilter={MODEL_FILTER}
		modelsReady={modelsReady} onClose={props.onClose}>
		{(_onModelsMissing, models) => <TranscriptGenerationRunner {...props} models={models} />}
	</AssistanceModelGate>;
}

function TranscriptGenerationRunner(props: Props & { readonly models: readonly LocalModelManagerModel[] }) {
	const [initial] = useState(props);
	useEffect(() => {
		let active = true;
		const bridge = resolveLocalAssistanceBridge(initial.bridgeScope);
		const options = {
			getProject: () => initial.controller.getSnapshot().project,
			targets: initial.targets, signal: initial.signal,
			onProgress: initial.onProgress,
			selectTarget: (target: TranscriptGenerationTarget) => {
				initial.controller.actions.timeline.selectClip(target.clipId);
				initial.controller.actions.timeline.setExactSelection(target.startFrame, target.endFrame,
					{ trackIds: [target.trackId], clipIds: [target.clipId], frequencyRange: null });
			},
			createSession: () => {
				const session = createLocalAssistanceGuidedSessionStore({ bridge,
					preparation: initial.controller.selectedMediaPreparation ?? null });
				session.selectWorkflow('transcribe-captions');
				session.setSettings(assistanceTaskSettingsForModels(SETTINGS, initial.models));
				return session;
			},
		};
		void generateProjectTranscripts(options).then(() => { if (active) initial.onDone(); })
			.catch((error: unknown) => { if (active) initial.onDone(error); });
		return () => { active = false; };
	}, [initial]);
	return null;
}
