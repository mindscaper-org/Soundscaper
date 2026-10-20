/* SPDX-License-Identifier: AGPL-3.0-only */

import { useContext, useEffect, useRef, type RefObject } from 'react';
import { LightscaperDesktopLifecycle, type LightscaperDesktopLifecycleBridge } from '../../controller/composition/lightscaper-desktop-lifecycle.ts';
import { useLightscaperPhotoBackendWorkspaceCurrentV1 } from './use-lightscaper-photo-backend-workspace-current-v1.ts';
import { PhotoLibraryDebugSoakContextCurrentV1 } from './photo-library-debug-soak-context-current-v1.ts';
import { lightscaperDesktopCloseCopy } from '../../../i18n/lightscaper-desktop-close-copy.ts';

export interface LightscaperDesktopLifecycleHookOptions {
	readonly app: RefObject<HTMLElement | null>;
	readonly locale: string;
	readonly isCurrent: () => boolean;
	readonly hasPendingWork: () => boolean;
	readonly hasOpenSurface: () => boolean;
	readonly fence: () => void;
	readonly retireAndJoin: () => Promise<void>;
}
interface LightscaperDesktopScope {
	readonly lightscaperDesktop?: { readonly v1?: LightscaperDesktopLifecycleBridge };
}

/** No feature is opened by mounting the desktop bridge. Existing menu/dialog
	* owners decide whether closing can preserve the current authoring state. */
export function useLightscaperDesktopLifecycle(options: LightscaperDesktopLifecycleHookOptions): void {
	useLightscaperPhotoBackendWorkspaceCurrentV1(options);
	const diagnostic = useContext(PhotoLibraryDebugSoakContextCurrentV1);
	const latest = useRef(options); latest.current = options;
	const ready = useRef(false);
	useEffect(() => {
		const bridge = (window as Window & LightscaperDesktopScope).lightscaperDesktop?.v1;
		if (!bridge) return;
		const owner = new LightscaperDesktopLifecycle({
			bridge: {
				onCloseRequested: listener => bridge.onCloseRequested(listener),
				respondToClose: response => bridge.respondToClose(response),
				signalReady: () => { if (ready.current) return; ready.current = true; return bridge.signalReady(); },
			},
			isMounted: () => latest.current.app.current?.isConnected === true && (latest.current.isCurrent() || diagnostic?.snapshot().busy === true),
			closeSafety: () => {
				const current = latest.current;
				if (diagnostic?.snapshot().busy || !current.isCurrent() || current.hasPendingWork()) return 'busy';
				return current.hasOpenSurface() || current.app.current?.querySelector('[role="dialog"]') ? 'open-surface' : 'ready';
			},
			fence: () => {
				diagnostic?.stop(); latest.current.fence();
				const root = latest.current.app.current;
				if (root) root.inert = true;
			},
			retireAndJoin: async () => { await Promise.all([latest.current.retireAndJoin(), diagnostic?.close()]); },
			reportVeto: reason => {
				const copy = lightscaperDesktopCloseCopy(latest.current.locale);
				window.alert?.(reason === 'busy' ? copy.busy : copy.openSurface);
			},
			reportError: () => { console.error('Lightscaper could not complete its desktop lifecycle.'); },
		});
		void owner.mount();
		return () => { void owner.dispose().catch(() => undefined); };
	}, [diagnostic]);
}
