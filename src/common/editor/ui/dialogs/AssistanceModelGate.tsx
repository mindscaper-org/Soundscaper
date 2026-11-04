/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { localModelManagerStoreFor } from '../local-model-manager-store.ts';
import type { LocalModelManagerBridge, LocalModelManagerModel } from '../local-model-manager-bridge.ts';
import { formatLocalModelBytes } from '../local-model-bytes.ts';
import { localModelDisplayName } from './local-model-display-name.ts';
import AssistanceLoadingDialog from './AssistanceLoadingDialog.tsx';

const LocalModelManagerDialog = lazyEditorModule(() => import('./LocalModelManagerDialog.tsx'));
const subscribeToNothing = (): (() => void) => () => undefined;
const emptySnapshot = () => null;

interface Props {
	readonly title: string;
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly locale: string;
	readonly bridge: LocalModelManagerBridge | null;
	readonly modelFilter: (model: LocalModelManagerModel) => boolean;
	readonly modelsReady?: (installedModels: readonly LocalModelManagerModel[]) => boolean;
	readonly configuration?: (disabled: boolean) => ReactNode;
	readonly requiresModel: boolean;
	readonly onClose: () => void;
	readonly children: ReactNode | ((onModelsMissing: () => void,
		installedModels: readonly LocalModelManagerModel[]) => ReactNode);
}

/** Admit a model-backed dialog before importing its processing and inference graph. */
export default function AssistanceModelGate({
	title, copy, locale, bridge, modelFilter, modelsReady, configuration, requiresModel, onClose, children,
}: Props) {
	const store = useMemo(() => bridge ? localModelManagerStoreFor(bridge) : null, [bridge]);
	const snapshot = useSyncExternalStore(store?.subscribe ?? subscribeToNothing,
		store?.getSnapshot ?? emptySnapshot, store?.getSnapshot ?? emptySnapshot);
	const [checked, setChecked] = useState(false);
	const [admitted, setAdmitted] = useState(false);
	const [recovering, setRecovering] = useState(false);
	const [recoveryRevision, setRecoveryRevision] = useState(0);
	const [managingModels, setManagingModels] = useState(false);
	const [downloading, setDownloading] = useState(false);
	const downloads = useRef<AbortController | null>(null);
	const missingModelIds = useRef(new Set<string>());
	const ready = snapshot !== null && (modelsReady
		? modelsReady(snapshot.models.filter(model => model.availability === 'installed'))
		: snapshot.models.some(model => modelFilter(model) && model.availability === 'installed'));
	const onModelsMissing = useCallback((): void => {
		missingModelIds.current.clear();
		setAdmitted(false);
		setChecked(false);
		setRecovering(true);
		setRecoveryRevision(revision => revision + 1);
	}, []);
	useEffect(() => {
		if (!store || !requiresModel || managingModels) return undefined;
		let active = true;
		setChecked(false);
		const disconnect = store.connect();
		void store.load().then(() => { if (active) setChecked(true); });
		return () => { active = false; disconnect(); };
	}, [store, requiresModel, managingModels, recoveryRevision]);
	useEffect(() => {
		if (checked && !recovering && !downloading && !managingModels && snapshot?.phase === 'ready'
			&& !snapshot.error && ready) {
			setAdmitted(true);
		}
	}, [checked, recovering, downloading, managingModels, ready, snapshot]);
	useEffect(() => {
		if (!recovering || !checked || !snapshot || snapshot.error) return;
		for (const model of snapshot.models.filter(modelFilter)) {
			if (model.availability === 'installable') missingModelIds.current.add(model.modelId);
		}
		if (ready && snapshot.models.some(model => model.availability === 'installed'
			&& missingModelIds.current.has(model.modelId))) setRecovering(false);
	}, [checked, modelFilter, ready, recovering, snapshot]);
	useEffect(() => () => downloads.current?.abort(), []);
	const close = (): void => { downloads.current?.abort(); onClose(); };
	const loading = <AssistanceLoadingDialog title={title} copy={copy} onClose={close} />;
	const processing = <Suspense fallback={loading}>{typeof children === 'function'
		? children(onModelsMissing, snapshot?.models.filter(model => model.availability === 'installed') ?? [])
		: children}</Suspense>;
	if (admitted || !requiresModel || !store || !snapshot) return processing;
	if (managingModels) return <Suspense fallback={loading}>
		<LocalModelManagerDialog bridge={bridge} copy={copy} locale={locale} modelFilter={modelFilter}
			onClose={() => { setChecked(false); setManagingModels(false); }} />
	</Suspense>;
	if (!checked || snapshot.phase === 'loading' || snapshot.phase === 'idle') return loading;
	const models = snapshot.models.filter(modelFilter);
	if (!recovering && !downloading && !snapshot.error && ready) {
		return processing;
	}
	const available = models.filter(({ availability }) => availability === 'installable'
		|| recovering && availability === 'installed');
	const downloadAll = async (): Promise<void> => {
		if (downloading) return;
		const controller = new AbortController();
		downloads.current = controller;
		setDownloading(true);
		try {
			if (recovering) for (const model of available) {
				if (controller.signal.aborted) return;
				if (model.availability === 'installed') await store.remove(model.modelId);
				if (store.getSnapshot().error) return;
			}
			await store.installAll(available.map(({ modelId }) => modelId), controller.signal);
			if (!controller.signal.aborted && !store.getSnapshot().error) setRecovering(false);
		}
		finally {
			if (!controller.signal.aborted) setDownloading(false);
			if (downloads.current === controller) downloads.current = null;
		}
	};
	return <AudioEditorDialogShell title={title} onClose={close} width={640} initialFocus="dialog"
		dataAttributes={{ 'data-assistance-model-prerequisites': 'true' }}
		footer={<DialogFooter rightContent={<>
			<Button variant="secondary" onClick={close}>{copy.cancel || 'Cancel'}</Button>
			<Button variant="secondary" disabled={downloading} onClick={() => setManagingModels(true)}>
				{copy.assistanceOpenModelManager || 'Open Model Manager'}</Button>
			<Button variant="primary" disabled={downloading || available.length === 0}
				onClick={() => { void downloadAll(); }}>{recovering ? copy.assistanceRedownload || 'Re-download'
					: copy.assistanceDownloadAll || 'Download all'}</Button>
		</>} />}>
		<div className="kw-assistance-model-prerequisites">
			<p>{recovering ? copy.assistanceModelsNeedDownload || 'A required model is missing or unavailable. Re-download the models below to continue.'
				: (copy.assistanceModelRequired || '{effect} requires a model to be downloaded before it can be executed:')
					.replaceAll('{effect}', title)}</p>
			{configuration?.(downloading)}
			<ul>{available.map((model) => {
				const progress = snapshot.progress.find(({ modelId }) => modelId === model.modelId);
				const name = localModelDisplayName(model.modelId, copy);
				return <li key={model.modelId}>
					{name} · {formatLocalModelBytes(model.downloadBytes, locale) || copy.localModelsSizeUnavailable || 'Unavailable'}
					{progress && <div>
						<label htmlFor={`assistance-download-${model.modelId}`}>{progress.fileName}</label>
						<progress id={`assistance-download-${model.modelId}`} aria-label={name}
							value={progress.completedBytes} max={progress.totalBytes} />
					</div>}
				</li>;
			})}</ul>
			{available.length === 0 && !snapshot.error && <p role="status">
				{copy.assistanceNoDownloadableModels || 'No compatible models are available to download on this device.'}</p>}
			{downloading && <progress aria-label={copy.localModelsInstalling || 'Installing'} />}
			{snapshot.error && <div role="alert">
				<p>{snapshot.error.modelId ? copy.localModelsOperationError || 'The local-model operation failed.'
					: copy.localModelsLoadError || 'Local models could not be loaded.'}</p>
				<p>{snapshot.error.message}</p>
				<Button variant="secondary" onClick={() => { void store.load(); }}>
					{copy.localModelsRetry || 'Retry'}</Button>
			</div>}
		</div>
	</AudioEditorDialogShell>;
}
