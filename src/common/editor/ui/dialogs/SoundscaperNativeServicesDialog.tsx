/* SPDX-License-Identifier: AGPL-3.0-only */
import { EditorComponentCopyProvider } from '../EditorComponentCopyProvider.tsx';

/**
 * The one surface behind every milestone-5A native menu entry.
 *
 * It is opened from a menu and nowhere else — the editor gains no permanent
 * chrome from the native tier. It manages installed effects and quarantined
 * versions; folder scanning settings live in Preferences → Effects.
 */

import NativeProcessingTheme from './NativeProcessingTheme.tsx';
import { ProcessingButton as Button } from './ProcessingButton.tsx';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import './ProcessingDialogs.css';
import React, { useEffect, useMemo, useSyncExternalStore, type KeyboardEvent } from 'react';
import { soundscaperPluginScanRuntimeFor } from '../soundscaper-plugin-scan-runtime.ts';
import type { NativePluginScanController } from '../../controller/effects/native-plugin-scan-controller.ts';
import SoundscaperPluginScanStatus, { canScanPluginFolders } from './SoundscaperPluginScanStatus.tsx';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { useNativePluginParameterClose } from './useNativePluginParameterClose.ts';
import {
	type SoundscaperNativeServicesBridge,
} from '../soundscaper-native-services-bridge.ts';
import {
	resolveSoundscaperNativeServicesCopy,
} from '../soundscaper-native-services-copy.ts';
import {
	EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
	type SoundscaperNativeServicesDialogAction,
	type SoundscaperNativeServicesDialogState,
} from '../soundscaper-native-services-dialog-model.ts';
import {
	createSoundscaperNativeServicesDialogRuntime,
	type SoundscaperNativeServicesDialogRuntime,
} from '../soundscaper-native-services-dialog-runtime.ts';
import {
	type SoundscaperNativeServiceSurface,
} from '../soundscaper-native-services-menu.ts';
import {
	SoundscaperNativeEffectManagePanel,
} from './SoundscaperNativeEffectPanels.tsx';
import type { SoundscaperVampAnalyzerSurfaceInput } from '../workspace/SoundscaperNativeServicesSurface.tsx';

const SoundscaperVampAnalyzerSurface = React.lazy(() => (
	import('../workspace/SoundscaperVampAnalyzerSurface.tsx')
));

export interface SoundscaperNativeServicesDialogProps {
	readonly processingBlocked?: boolean;
	readonly scanner?: NativePluginScanController;
	readonly bridge: SoundscaperNativeServicesBridge;
	readonly initialSurface: SoundscaperNativeServiceSurface;
	readonly initialState?: SoundscaperNativeServicesDialogState;
	readonly runtime?: SoundscaperNativeServicesDialogRuntime;
	readonly copy?: Readonly<Record<string, string | undefined>>;
	readonly locale?: string;
	readonly vampAnalyzerInput?: Readonly<SoundscaperVampAnalyzerSurfaceInput> | null;
	readonly onClose: () => void;
}

export default function SoundscaperNativeServicesDialog(props: SoundscaperNativeServicesDialogProps) {
	const content = props.initialSurface === 'native-analyzer-use'
		? (props.vampAnalyzerInput == null ? null : <React.Suspense fallback={null}>
			<SoundscaperVampAnalyzerSurface input={props.vampAnalyzerInput} copy={props.copy} onClose={props.onClose} />
		</React.Suspense>)
		: <NativeProcessingTheme><NativeServicesDialog {...props} /></NativeProcessingTheme>;
	return <EditorComponentCopyProvider copy={props.copy ?? {}} locale={props.locale ?? 'en'}>{content}</EditorComponentCopyProvider>;
}

function NativeServicesDialog({
	bridge,
	scanner: workspaceScanner,
	processingBlocked = false,
	initialState = EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
	runtime: workspaceRuntime,
	copy: hostCopy,
	onClose,
}: SoundscaperNativeServicesDialogProps) {
	const copy = useMemo(() => resolveSoundscaperNativeServicesCopy(hostCopy), [hostCopy]);
	const surface = 'native-effect-manage';
	const scanner = workspaceScanner ?? soundscaperPluginScanRuntimeFor(bridge);
	const scan = useSyncExternalStore(scanner.subscribe, scanner.getSnapshot, scanner.getSnapshot);
	const localRuntime = useMemo(
		() => createSoundscaperNativeServicesDialogRuntime(bridge, initialState),
		[bridge, initialState],
	);
	const runtime = workspaceRuntime ?? localRuntime;
	const state = useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);
	const close = useNativePluginParameterClose(state.pluginInstance?.instanceId ?? null, onClose);
	const perform = useMemo(() => (action: SoundscaperNativeServicesDialogAction): void => {
		void runtime.perform(action).then((next) => {
			if (action.type === 'clear-quarantine' && action.clearance === 'rescan' && !next.error) void scanner.scan();
		});
	}, [runtime, scanner]);
	useEffect(() => { perform({ type: 'refresh' }); }, [perform, scan.generation, scan.status]);

	const surfaces = [surface] as const;
	const busy = state.pending !== null || scan.status === 'running' || Object.values(state.scans).some((scan) => scan.running);
	const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
		if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
		if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
		event.preventDefault();
	};

	return <AudioEditorDialogShell
		title={copy.pluginManage.replace(/…$/u, '')}
		onClose={close}
		width={760}
		initialFocus={`[data-native-service-tab="${surface}"]`}
		dataAttributes={{ 'data-soundscaper-native-services-dialog': 'true' }}
		footer={<DialogFooter className="audio-editor-dialog-footer" leftContent={<div className="kw-processing-actions">
			<Button disabled={state.pending !== null} data-native-service-refresh="true"
				onClick={() => perform({ type: 'refresh' })}>{copy.refresh}</Button>
			<Button disabled={busy || !canScanPluginFolders(state.plugins)}
				onClick={() => { void scanner.scan(); }}>{scan.status === 'running' ? copy.scanRunning : copy.scanPluginFolders}</Button>
		</div>} rightContent={
			<Button variant="primary" onClick={close}>{copy.close}</Button>} />}
	>
		<div className="audio-editor-soundscaper-native-services">
			<div className="kw-processing-tabs" role="tablist" aria-label={copy.nativeServiceSurfaces}>
				{surfaces.map((candidate) => <button
					key={candidate}
					id={tabId(candidate)}
					type="button"
					role="tab"
					aria-selected={surface === candidate}
					aria-controls={panelId(candidate)}
					tabIndex={surface === candidate ? 0 : -1}
					data-native-service-tab={candidate}
					onKeyDown={handleTabKey}
				>{copy.tabEffectManage}</button>)}
			</div>
			<p role="status" aria-live="polite" aria-busy={busy ? 'true' : undefined}>
				{state.error || (busy ? copy.working : state.completed === null ? '' : copy.operationComplete)}
			</p>
			<SoundscaperPluginScanStatus scan={scan} plugins={state.plugins} copy={copy} />
			<section
				id={panelId(surface)}
				role="tabpanel"
				aria-labelledby={tabId(surface)}
				tabIndex={0}
			>
				<SoundscaperNativeEffectManagePanel
					copy={copy}
					state={state}
					disabled={busy}
					processingBlocked={processingBlocked}
					perform={perform}
				/>
			</section>
		</div>
	</AudioEditorDialogShell>;
}

function tabId(surface: SoundscaperNativeServiceSurface): string {
	return `soundscaper-native-service-tab-${surface}`;
}

function panelId(surface: SoundscaperNativeServiceSurface): string {
	return `soundscaper-native-service-panel-${surface}`;
}
