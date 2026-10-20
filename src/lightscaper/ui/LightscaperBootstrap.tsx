/* SPDX-License-Identifier: AGPL-3.0-only */

import LightscaperAppCurrentV1, { type LightscaperAppPropsCurrentV1 } from '../../common/editor/ui/lightscaper/LightscaperAppCurrentV1.tsx';
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { LightscaperPhotoBackendSwitchCurrentV1 } from '../../common/editor/controller/composition/lightscaper-photo-backend-switch-current-v1.ts';
import { LightscaperPhotoBackendContextCurrentV1 } from '../../common/editor/ui/lightscaper/photo-library-backend-context-current-v1.ts';
import { PhotoLibraryLinkedCommandsCurrentV1 } from '../../common/editor/controller/composition/photo-library-linked-commands-current-v1.ts';
import { PhotoLinkedCommandsContextCurrentV1 } from '../../common/editor/ui/lightscaper/photo-linked-commands-context-current-v1.ts';
import PhotoLinkedLibraryMenuCurrentV1 from '../../common/editor/ui/lightscaper/PhotoLinkedLibraryMenuCurrentV1.tsx';
import { PhotoLibraryDebugSoakOwnerCurrentV1 } from '../quality/photo-library-debug-soak-owner-current-v1.ts';
import { PhotoLibraryDebugSoakContextCurrentV1 } from '../../common/editor/ui/lightscaper/photo-library-debug-soak-context-current-v1.ts';
import PhotoLibraryDebugSoakMenuCurrentV1 from '../../common/editor/ui/lightscaper/PhotoLibraryDebugSoakMenuCurrentV1.tsx';
import PhotoLibraryBackendMenuCurrentV1 from '../../common/editor/ui/lightscaper/PhotoLibraryBackendMenuCurrentV1.tsx';
import { captureDesktopPhotoBackendPortsCurrentV1, createDesktopPhotoBackendFactoriesCurrentV1 } from '../desktop-photo-library-backend-current-v1.ts';
import { bundledSiteCopyForLocale } from '../../common/i18n/site-copy.js';
import type { CreatePhotoLibraryDevelopProxyRuntimeV3 } from '../../common/editor/photo-library-develop-proxy-port-v3.ts';

function useCapturedMethod<T extends (...args: never[]) => unknown>(method: T | undefined, receiver: unknown): T | undefined {
	const capture = () => ({ method, invoke: method ? ((...args: Parameters<T>) => Reflect.apply(method, receiver, args)) as T : undefined });
	const pinned = useRef(capture()); if (pinned.current.method !== method) pinned.current = capture();
	return pinned.current.invoke;
}

// This product composition deliberately has no audio/timeline controller.
export default function LightscaperBootstrap(props: LightscaperAppPropsCurrentV1) {
	const suppliedSession = useCapturedMethod(props.createSession, props), suppliedBackup = useCapturedMethod(props.loadBackupSaveRuntime, props);
	const suppliedQuery = useCapturedMethod(props.loadMetadataQueryRuntime, props), suppliedSaved = useCapturedMethod(props.loadSavedFilterRuntime, props);
	const suppliedRestore = useCapturedMethod(props.loadRestoreRuntime, props), suppliedRenderer = useCapturedMethod(props.loadDevelopProxyRuntime, props);
	const customized = !!(suppliedSession || suppliedBackup || suppliedQuery || suppliedSaved || suppliedRestore || suppliedRenderer);
	const [ports] = useState(() => captureDesktopPhotoBackendPortsCurrentV1((window as Window & { lightscaperDesktop?: unknown }).lightscaperDesktop));
	const [backend] = useState(() => new LightscaperPhotoBackendSwitchCurrentV1({ nativeAvailable: !customized && !!ports }));
	const selection = useSyncExternalStore(backend.subscribe, backend.snapshot, backend.snapshot);
	const native = useMemo(() => ports ? createDesktopPhotoBackendFactoriesCurrentV1(bundledSiteCopyForLocale(props.locale).workspacePhoto, ports) : undefined, [ports, props.locale]);
	const linkedCommands=useMemo(()=>new PhotoLibraryLinkedCommandsCurrentV1({
		resolveSession:async session=>(await import('../desktop-photo-linked-library-current-v1.ts')).getDesktopPhotoLinkedLibraryCurrentV1(session),
		async revoke(grantId){if(!native||backend.snapshot().backend!=='native')throw new Error('Linked management requires the selected native backend.');
			const transitioned=await backend.retireAndRun(async()=>{const session=await native.createSession();let failed=false,primary:unknown;
				try{const runtime=(await import('../desktop-photo-linked-library-current-v1.ts')).getDesktopPhotoLinkedLibraryCurrentV1(session);if(!runtime)throw new Error('Native linked management is unavailable.');await runtime.revoke(grantId);}
				catch(error){failed=true;primary=error;}try{await session.close();}catch(cleanup){throw new AggregateError([...(failed?[primary]:[]),cleanup],'Linked revocation Session did not retire.',{cause:cleanup});}if(failed)throw primary;
			});if(!transitioned)throw new Error('Close photo dialogs and finish pending work before revoking a folder.');
		},
	}),[native,backend]);
	const createSession = useCallback(async () => {
		const runtime = await import('../photo-library-session-runtime-current-v1.ts');
		return runtime.createPhotoLibrarySessionCurrentV1({ name: bundledSiteCopyForLocale(props.locale).workspacePhoto,
			recoverRestores: async (settings, signal) => {
				const recovery = await import('../storage/photo-library-restore-recovery-v1.ts');
				await recovery.recoverPhotoLibraryRestoreV1({ settings, indexedDB: globalThis.indexedDB, locks: globalThis.navigator?.locks ?? null, signal });
			} });
	}, [props.locale]);
	const loadRestoreRuntime = useCallback(async () => {
		const runtime = await import('../photo-library-restore-runtime-current-v1.ts');
		return runtime.createPhotoLibraryRestoreRuntimeCurrentV1({ name: bundledSiteCopyForLocale(props.locale).workspacePhoto });
	}, [props.locale]);
	const loadBackupSaveRuntime = useCallback(async () => {
		const runtime = await import('../photo-library-backup-save-runtime.ts');
		return runtime.createPhotoLibraryBackupSaveRuntimeV1();
	}, []);
	const loadMetadataQueryRuntime = useCallback(async () => (await import('../photo-metadata-query-ui-runtime.ts')).PHOTO_METADATA_QUERY_RUNTIME_V2, []);
	const loadSavedFilterRuntime = useCallback(async () => (await import('../photo-saved-filter-ui-runtime-v1.ts')).PHOTO_SAVED_FILTER_RUNTIME_V1, []);
	const loadDevelopProxyRuntime = useCallback<CreatePhotoLibraryDevelopProxyRuntimeV3>(async (source, maskSource) => {
		return (await import('../photo-develop-render-runtime-current-v1.ts')).createPhotoDevelopRenderRuntimeCurrentV1({ source,
			...(maskSource === undefined ? {} : { maskSource }) });
	}, []);
	const nativeSelected = !customized && selection.backend === 'native';
	const selectedSession = suppliedSession ?? (nativeSelected ? native?.createSession ?? createSession : createSession);
	const diagnostic = useMemo(() => new PhotoLibraryDebugSoakOwnerCurrentV1(backend, selectedSession), [backend, selectedSession]);
	return <PhotoLibraryDebugSoakContextCurrentV1.Provider value={customized ? null : diagnostic}><PhotoLinkedCommandsContextCurrentV1.Provider value={customized ? null : linkedCommands}><LightscaperPhotoBackendContextCurrentV1.Provider value={customized ? null : backend}>
		<LightscaperAppCurrentV1 key={selection.epoch} locale={props.locale} createSession={selectedSession}
		loadBackupSaveRuntime={suppliedBackup ?? loadBackupSaveRuntime}
		loadMetadataQueryRuntime={suppliedQuery ?? loadMetadataQueryRuntime}
		loadSavedFilterRuntime={suppliedSaved ?? loadSavedFilterRuntime}
		loadRestoreRuntime={suppliedRestore ?? (nativeSelected ? native?.loadRestoreRuntime : loadRestoreRuntime)}
		loadDevelopProxyRuntime={suppliedRenderer ?? loadDevelopProxyRuntime} />
		<PhotoLibraryBackendMenuCurrentV1 locale={props.locale} /><PhotoLinkedLibraryMenuCurrentV1 locale={props.locale} /><PhotoLibraryDebugSoakMenuCurrentV1 locale={props.locale} />
	</LightscaperPhotoBackendContextCurrentV1.Provider></PhotoLinkedCommandsContextCurrentV1.Provider></PhotoLibraryDebugSoakContextCurrentV1.Provider>;
}
