/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { audiocomCopy } from '../../../i18n/audiocom-copy.ts';
import { AUDIO_COM_DEFAULT_SERVER_URL } from '../../advanced-preferences.ts';
import {
	createAudiocomPanelSession,
	audiocomPanelSession,
	type AudiocomPanelSession,
} from '../../controller/import/audiocom-panel-session.ts';
import { audiocomProjectArchives, createAudiocomProjectArchives } from '../../controller/import/audiocom-project-archives.ts';
import { enqueueAudiocomProjectAudio, saveAudiocomEditorProject } from '../../controller/import/audiocom-project-actions.ts';
import AudiocomPanel from './AudiocomPanel.tsx';

export interface AudiocomPanelContainerProps {
	readonly controller?: object;
	readonly snapshot: Readonly<Record<string, unknown>>;
	readonly copy: Readonly<Record<string, string>>;
	readonly locale?: unknown;
	readonly disabled?: boolean;
	readonly blocked?: boolean;
	readonly panelActive?: boolean;
	readonly session?: AudiocomPanelSession;
}

export default function AudiocomPanelContainer({
	controller, snapshot, copy, locale, disabled = false, blocked = false, panelActive = true, session: providedSession,
}: AudiocomPanelContainerProps) {
	const configuredServer = record(record(snapshot.preferences)?.advanced)?.audioComServerUrl;
	const apiOrigin = typeof configuredServer === 'string' ? configuredServer : AUDIO_COM_DEFAULT_SERVER_URL;
	const session = useMemo(() => providedSession ?? (controller ? audiocomPanelSession(controller, { apiOrigin }) : createAudiocomPanelSession({ apiOrigin })),
		[controller, providedSession, apiOrigin]);
	const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
	const archives = useMemo(() => {
		const options = { apiOrigin,
			onAuthenticationExpired: () => { void session.disconnect(); } };
		return controller ? audiocomProjectArchives(controller, options) : createAudiocomProjectArchives(options);
	}, [apiOrigin, controller, session]);
	const archiveState = useSyncExternalStore(archives.subscribe, archives.getSnapshot, archives.getSnapshot);
	const localizedCopy = useMemo(() => {
		const resolved = audiocomCopy(locale ?? snapshot.locale, copy);
		return archiveState.provider?.kind === 'audiocity'
			? Object.fromEntries(Object.entries(resolved).map(([key, value]) => [key, value.replaceAll('audio.com', 'Audiocity')])) : resolved;
	}, [copy, locale, snapshot.locale, archiveState.provider]);
	const [linkError, setLinkError] = useState('');
	const [projectActionError, setProjectActionError] = useState('');
	const [projectActionPending, setProjectActionPending] = useState(false);
	const [publishItemId, setPublishItemId] = useState<string>();
	const projectAction = (action: 'audio' | 'project'): void => {
		if (!controller || projectActionPending || state.auth.status !== 'connected') return;
		setProjectActionError(''); setProjectActionPending(true);
		void (action === 'audio'
			? enqueueAudiocomProjectAudio(controller, session).then(id => setPublishItemId(id))
			: saveAudiocomEditorProject(controller, archives))
			.catch((reason: unknown) => setProjectActionError(reason instanceof Error ? reason.message : localizedCopy.uploadError))
			.finally(() => setProjectActionPending(false));
	};
	const openLink = useCallback((url: string) => {
		setLinkError('');
		void Promise.resolve().then(async () => {
			const bridge = (globalThis as typeof globalThis & {
				soundscaperDesktop?: { v1?: { openAudiocomLink?: (url: string) => Promise<unknown> } };
			}).soundscaperDesktop?.v1;
			if (!bridge?.openAudiocomLink) throw new Error(localizedCopy.openLinkError);
			await bridge.openAudiocomLink(url);
		}).catch((reason: unknown) => setLinkError(reason instanceof Error ? reason.message : localizedCopy.openLinkError));
	}, [localizedCopy.openLinkError]);
	const devices = record(snapshot.audioDevices);
	const outputDevice = typeof devices?.preferredOutputDeviceId === 'string'
		&& !devices.preferredOutputDeviceId.startsWith('native:') ? devices.preferredOutputDeviceId : '';
	const gain = Number(devices?.playbackGain ?? 1);
	useEffect(() => {
		void session.initialize();
		return () => {
			if (controller && !providedSession) session.setActive(false);
			else session.dispose();
		};
	}, [controller, providedSession, session]);
	useEffect(() => session.setActive(panelActive), [panelActive, session]);
	useEffect(() => session.setListeningPreferences(gain, outputDevice), [gain, outputDevice, session]);
	useEffect(() => { void archives.initialize(); return () => { if (!controller) archives.dispose(); }; }, [archives, controller]);
	useEffect(() => { void archives.setConnected(state.auth.status === 'connected'); }, [archives, state.auth.status]);
	return <AudiocomPanel copy={localizedCopy} state={state} disabled={disabled} linkError={linkError}
		onOpenLink={globalThis.location?.protocol === 'soundscaper-app:' ? openLink : undefined}
		onSearch={(request) => { void session.search(request); }}
		onPreview={(id) => { void session.preview(id); }} onStopPreview={session.stopPreview}
		onConnect={() => { void session.connect(); }} onDisconnect={() => { void session.disconnect(); }}
		onUploadFiles={(files) => { session.enqueueFiles(files); }} onPublish={session.publish}
		onRetry={session.retry} onCancel={session.cancel} onRemove={session.remove}
		onUploadAudio={() => projectAction('audio')} onSaveProject={() => projectAction('project')}
		projectActionsDisabled={!controller || !snapshot.project || blocked || projectActionPending}
		saveProjectDisabled={!archiveState.supported || ['loading', 'uploading'].includes(archiveState.status)}
		projectActionError={projectActionError} publishItemId={publishItemId}
		archives={{ state: archiveState, onRefresh: page => { void archives.refresh(page); },
			onCancel: archives.cancel }} />;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}
