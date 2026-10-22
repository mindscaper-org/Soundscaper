/* SPDX-License-Identifier: AGPL-3.0-only */

import { useContext, useEffect, useRef } from 'react';
import type { LightscaperDesktopLifecycleHookOptions } from './use-lightscaper-desktop-lifecycle.ts';
import { LightscaperPhotoBackendContextCurrentV1 } from './photo-library-backend-context-current-v1.ts';

/** Reuses the existing Kernel's full workspace retirement owner. This hook
	* never guesses a partial set of editors, transfers, or Session consumers. */
export function useLightscaperPhotoBackendWorkspaceCurrentV1(options: LightscaperDesktopLifecycleHookOptions): void {
	const owner = useContext(LightscaperPhotoBackendContextCurrentV1), latest = useRef(options); latest.current = options;
	useEffect(() => {
		if (!owner) return;
		const root = latest.current.app.current;
		const restore = root?.querySelector('[data-photo-restore-menu]'), backup = root?.querySelector('[data-photo-backup-menu]');
		const target = restore?.closest('.lightscaper-menu-items');
		// Both unique File actions must have the same actual top-level menu owner.
		if (!root || !target || !backup || !target.contains(backup) || !target.closest('[name="lightscaper-application-menu"]')) return;
		let retire: (() => Promise<void>) | undefined;
		const unregister = owner.register({ target,
			safety: () => {
				const current = latest.current;
				if (!root.isConnected || !current.isCurrent() || current.hasPendingWork()) return 'busy';
				return current.hasOpenSurface() || root.querySelector('[role="dialog"]') ? 'open-surface' : 'ready';
			},
			fence: () => { const current = latest.current, captured = current.retireAndJoin; retire = () => Reflect.apply(captured, current, []) as Promise<void>; current.fence(); root.inert = true; },
			retireAndJoin: () => { if (!retire) throw new Error('Workspace must be fenced before retirement.'); return retire(); },
		});
		const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => owner.refresh());
		observer?.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['role', 'open'] });
		return () => { observer?.disconnect(); unregister(); };
	}, [owner]);
	useEffect(() => { owner?.refresh(); });
}
