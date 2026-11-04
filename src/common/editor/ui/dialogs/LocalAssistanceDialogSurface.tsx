/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useState } from 'react';

import type { LocalAssistanceDialogProps } from './LocalAssistanceDialog.tsx';
import { resolveLocalModelManagerBridge } from '../local-model-manager-availability.ts';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import { defaultAssistanceWorkflowSettingsV1, type AssistanceWorkflowSettingsV1 } from '../../assistance/workflow-settings-v1.ts';
import type { LocalModelManagerModel } from '../local-model-manager-bridge.ts';
import { assistanceTaskAvailableModelFilter, assistanceTaskModelFilter, assistanceTaskModelsReady, assistanceTaskRequiresModels } from
	'../../controller/assistance/local-assistance-task-models.ts';
import AssistanceModelGate from './AssistanceModelGate.tsx';
import { assistanceTaskLabel } from '../assistance-task-catalog.ts';
import AssistanceRecognizerPrerequisite from './AssistanceRecognizerPrerequisite.tsx';
import { assistanceTaskSettingsForModels } from '../local-assistance-task-controls.ts';

const LocalAssistanceDialog = lazyEditorModule(() => import('./LocalAssistanceRuntimeDialog.tsx'));

export interface LocalAssistanceDialogSurfaceProps
	extends Omit<LocalAssistanceDialogProps, 'bridge'> {
	readonly bridgeScope: unknown;
}

/** Resolve the desktop capability only after the menu-owned dialog is requested. */
export default function LocalAssistanceDialogSurface({
	bridgeScope, ...props
}: LocalAssistanceDialogSurfaceProps) {
	return <LocalAssistanceModelPreflight key={props.request?.mode === 'task' ? props.request.workflowId : 'advanced'}
		bridgeScope={bridgeScope} {...props} />;
}

function LocalAssistanceModelPreflight({ bridgeScope, ...props }: LocalAssistanceDialogSurfaceProps) {
	const modelBridge = useMemo(() => resolveLocalModelManagerBridge(bridgeScope), [bridgeScope]);
	const [settings, setSettings] = useState(() => props.request?.mode === 'task'
		? defaultAssistanceWorkflowSettingsV1(props.request.workflowId) : null);
	const [recovering, setRecovering] = useState(false);
	const [healthyModelIds, setHealthyModelIds] = useState<readonly string[]>([]);
	const title = props.request?.mode === 'task' ? assistanceTaskLabel(props.request.workflowId, props.copy)
		: props.copy.advancedLocalProcessing || 'Advanced Local Processing';
	return <AssistanceModelGate title={title} copy={props.copy} locale={props.locale ?? 'en'}
		bridge={modelBridge} requiresModel={settings !== null && assistanceTaskRequiresModels(settings)}
		modelsReady={settings ? installedModels => assistanceTaskModelsReady(
			recovering ? settings : assistanceTaskSettingsForModels(settings, installedModels), installedModels, [],
		) : undefined}
		configuration={settings?.workflowId === 'transcribe-captions' ? disabled => (
			<AssistanceRecognizerPrerequisite settings={settings} copy={props.copy} disabled={disabled}
				onChange={setSettings} />
		) : undefined}
		modelFilter={settings ? recovering ? model => assistanceTaskModelFilter(settings)(model)
			&& !healthyModelIds.includes(model.modelId)
			: assistanceTaskAvailableModelFilter(settings) : () => true} onClose={props.onClose}>
		{(onModelsMissing, installedModels) => <LocalAssistanceAdmittedTask {...props}
			settings={settings} recovering={recovering} installedModels={installedModels}
			bridgeScope={bridgeScope} modelBridge={modelBridge} onModelsMissing={(currentSettings, installedModelIds) => {
				setSettings(currentSettings);
				setRecovering(true);
				setHealthyModelIds(installedModelIds ?? []);
				onModelsMissing();
			}} />}
	</AssistanceModelGate>;
}

/** Stable settings keep inventory and workflow custody alive across gate renders. */
function LocalAssistanceAdmittedTask({ settings, recovering, installedModels, ...props }:
	LocalAssistanceDialogSurfaceProps & Readonly<{
		settings: AssistanceWorkflowSettingsV1 | null;
		recovering: boolean;
		installedModels: readonly LocalModelManagerModel[];
	}>) {
	const [initialSettings] = useState(() => settings && !recovering
		? assistanceTaskSettingsForModels(settings, installedModels) : settings ?? undefined);
	return <LocalAssistanceDialog {...props} initialSettings={initialSettings} />;
}
