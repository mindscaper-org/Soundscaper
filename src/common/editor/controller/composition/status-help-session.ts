/* SPDX-License-Identifier: AGPL-3.0-only */

interface StatusHelpSnapshot {
	readonly enabled: boolean;
	readonly text: string | null;
	readonly backgrounded: boolean;
}

/** Browser resources enter at attachment; only the status consumer receives hover updates. */
export function createStatusHelpSession() {
	let snapshot: StatusHelpSnapshot = Object.freeze({ enabled: false, text: null, backgrounded: false });
	const listeners = new Set<() => void>();
	const publish = (next: StatusHelpSnapshot) => {
		if (next.enabled === snapshot.enabled && next.text === snapshot.text && next.backgrounded === snapshot.backgrounded) return;
		snapshot = Object.freeze(next);
		for (const listener of listeners) listener();
	};
	return {
		getSnapshot: () => snapshot,
		getEnabled: () => snapshot.enabled,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		setEnabled(enabled: boolean) { publish({ enabled, text: null, backgrounded: false }); },
		attach(root: HTMLElement, resolve: (target: Element | null) => string | null) {
			const document = root.ownerDocument;
			const view = document.defaultView;
			if (!view || !snapshot.enabled) return () => undefined;
			let disposed = false;
			let frame: number | null = null;
			let target: Element | null = document.activeElement;
			const update = () => {
				frame = null;
				if (!disposed && snapshot.enabled) publish({ ...snapshot, text: resolve(target) });
			};
			const schedule = () => { if (frame === null) frame = view.requestAnimationFrame(update); };
			const over = (event: Event) => {
				target = event.target instanceof Element ? event.target : null;
				schedule();
			};
			const out = (event: Event) => {
				const related = (event as MouseEvent | FocusEvent).relatedTarget;
				target = related instanceof Element && root.contains(related) ? related : null;
				schedule();
			};
			const background = () => { target = null; publish({ ...snapshot, text: null, backgrounded: true }); };
			const foreground = () => { target = document.activeElement; publish({ ...snapshot, backgrounded: false }); schedule(); };
			const bindings = [['pointermove', over], ['pointerover', over], ['focusin', over], ['input', over], ['change', over], ['pointerout', out], ['focusout', out]] as const;
			for (const [type, listener] of bindings) root.addEventListener(type, listener, true);
			view.addEventListener('blur', background);
			view.addEventListener('focus', foreground);
			publish({ ...snapshot, backgrounded: !document.hasFocus() });
			schedule();
			return () => {
				if (disposed) return;
				disposed = true;
				if (frame !== null) view.cancelAnimationFrame(frame);
				for (const [type, listener] of bindings) root.removeEventListener(type, listener, true);
				view.removeEventListener('blur', background);
				view.removeEventListener('focus', foreground);
				publish({ ...snapshot, text: null, backgrounded: false });
			};
		},
	};
}
