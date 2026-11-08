/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistanceGuidedWorkflowId } from '../../assistance/workflow-recipes.ts';
import type { AssistanceWorkflowSettingsV1 } from '../../assistance/workflow-settings-v1.ts';
import type { LocalAssistanceBridge } from '../../assistance/local-assistance-bridge.ts';
import type { LocalAssistanceSelectedMediaPreparationPort } from '../../assistance/local-assistance-preparation.ts';
import type { LocalAssistanceGuidedSessionStore, LocalAssistanceGuidedSnapshot } from
	'../local-assistance-guided-session-store.ts';
import type { LocalAssistanceSnapshot } from '../local-assistance-session-types.ts';
import { assistanceTaskHasControls, assistanceTaskSettingsForModels } from '../local-assistance-task-controls.ts';
import { assistanceTaskModelsReady } from '../../controller/assistance/local-assistance-task-models.ts';
import { executeLocalAssistanceTask, localAssistanceTaskAppliesDirectly } from '../local-assistance-task-execution.ts';
import { executeLocalAssistanceTaskBatch } from '../local-assistance-task-batch-execution.ts';

interface Options {
	readonly preparation: LocalAssistanceSelectedMediaPreparationPort | null;
	readonly bridge: LocalAssistanceBridge | null;
	readonly onModelsMissing?: (settings: AssistanceWorkflowSettingsV1, installedModelIds?: readonly string[]) => void;
}

export function useLocalAssistanceTaskExecution(
	store: LocalAssistanceGuidedSessionStore, workflowId: AssistanceGuidedWorkflowId | null,
	inventory: LocalAssistanceSnapshot, guided: LocalAssistanceGuidedSnapshot, onClose: () => void,
	{ preparation, bridge, onModelsMissing }: Options,
) {
	const started = useRef(false);
	const modelChoiceInitialized = useRef(false);
	const recovering = useRef(false);
	const alive = useRef(true);
	const cancellation = useRef<AbortController | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [batchSnapshot, setBatchSnapshot] = useState<LocalAssistanceGuidedSnapshot | null>(null);
	const taskSnapshot = batchSnapshot ?? guided;
	const direct = workflowId !== null && localAssistanceTaskAppliesDirectly(workflowId);
	useEffect(() => {
		alive.current = true;
		return () => { alive.current = false; cancellation.current?.abort(); };
	}, []);
	const run = useCallback(async (): Promise<void> => {
		if (!workflowId) return store.run();
		const controller = new AbortController();
		cancellation.current = controller;
		try {
			if (localAssistanceTaskAppliesDirectly(workflowId) && preparation?.createAudioEffectBatch
				&& guided.settings) {
				setBatchSnapshot({ ...guided, phase: 'preparing', canRun: false, canCancel: true });
				const batch = await preparation.createAudioEffectBatch(workflowId);
				const result = await executeLocalAssistanceTaskBatch({ batch, bridge, workflowId,
					settings: guided.settings, signal: controller.signal,
					onSnapshot: snapshot => { if (alive.current) setBatchSnapshot(snapshot); } });
				if (alive.current) setBatchSnapshot(result);
			} else await executeLocalAssistanceTask(store, workflowId);
		} catch (failure) {
			if (alive.current && !controller.signal.aborted) {
				setError(failure instanceof Error ? failure.message : 'Processing failed.');
			}
		} finally {
			if (cancellation.current === controller) cancellation.current = null;
		}
	}, [bridge, guided, preparation, store, workflowId]);
	useEffect(() => {
		if (!workflowId || !guided.settings || !guided.canRun
			|| inventory.phase === 'idle' || inventory.phase === 'loading') return;
		const settings = assistanceTaskSettingsForModels(guided.settings, inventory.models);
		if (!modelChoiceInitialized.current) {
			if (settings !== guided.settings) { store.setSettings(settings); return; }
			modelChoiceInitialized.current = true;
		}
		if (!direct || assistanceTaskHasControls(settings, inventory.models) || started.current
			|| inventory.sources.length === 0
			|| !assistanceTaskModelsReady(settings, inventory.models, inventory.sources)) return;
		started.current = true;
		void run();
	}, [direct, guided.canRun, guided.settings, inventory, run, store, workflowId]);
	useEffect(() => {
		if (!bridge?.workflow || !preparation || !workflowId || !taskSnapshot.settings || recovering.current || !onModelsMissing
			|| inventory.phase === 'idle' || inventory.phase === 'loading') return;
		const modelUnavailable = taskSnapshot.unavailableReason === 'model-unavailable'
			|| taskSnapshot.unavailableReason === 'model-binding-unavailable';
		const settings = modelChoiceInitialized.current || modelUnavailable ? taskSnapshot.settings
			: assistanceTaskSettingsForModels(taskSnapshot.settings, inventory.models);
		const modelsReady = assistanceTaskModelsReady(settings, inventory.models, inventory.sources);
		if (modelUnavailable) {
			recovering.current = true;
			void bridge.models().then(models => {
				if (!alive.current) return;
				onModelsMissing(settings, assistanceTaskModelsReady(settings, models, inventory.sources)
					? undefined : models.map(({ modelId }) => modelId));
			}, () => { if (alive.current) onModelsMissing(settings); });
		} else if ((inventory.phase === 'ready' || inventory.phase === 'selection-required') && !modelsReady) {
			recovering.current = true;
			onModelsMissing(settings, inventory.models.map(({ modelId }) => modelId));
		}
	}, [bridge, inventory, onModelsMissing, preparation, taskSnapshot.settings, taskSnapshot.unavailableReason, workflowId]);
	useEffect(() => {
		if (direct && taskSnapshot.phase === 'accepted' && !taskSnapshot.error) onClose();
	}, [direct, taskSnapshot.error, taskSnapshot.phase, onClose]);
	return { direct, run, error, snapshot: taskSnapshot };
}
