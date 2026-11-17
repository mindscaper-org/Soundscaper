/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { MenuTooltipProvider } from './MenuTooltipProvider.tsx';
import { createMenuTooltipResolver } from './menu-tooltip-copy.ts';
import { createEditorTooltipShortcutResolver } from './editor-tooltip-shortcut.ts';

interface ShortcutController {
	readonly subscribe: (listener: () => void) => () => void;
	readonly getSnapshot: () => Readonly<{ preferences?: Readonly<{ shortcuts?: Readonly<Record<string, readonly string[]>> }> }>;
}
const noSubscribe = () => () => undefined;

export function EditorMenuTooltips({ copy, children, controller }: {
	readonly copy: Readonly<Record<string, unknown>>;
	readonly children: ReactNode;
	readonly controller?: ShortcutController;
}) {
	const readShortcuts = useCallback(() => controller?.getSnapshot().preferences?.shortcuts, [controller]);
	const shortcuts = useSyncExternalStore(controller?.subscribe ?? noSubscribe, readShortcuts, readShortcuts);
	const resolveShortcut = useMemo(() => createEditorTooltipShortcutResolver([], shortcuts, copy), [shortcuts, copy]);
	const resolve = useMemo(() => {
		const text = createMenuTooltipResolver(copy);
		return (label: string, id: string): ReactNode => {
			const description = text(label, id);
			if (id !== 'audacity-limiter') return description;
			return <>{description}<svg viewBox="0 0 260 72" aria-hidden="true">
				<path d="M0 36H260" stroke="currentColor" opacity=".2" />
				<path d="M0 14H260M0 58H260" stroke="currentColor" strokeDasharray="4 4" opacity=".5" />
				<path d="M0 36L16 28L32 44L48 7L64 65L80 28L96 44L112 0L128 72L144 28L160 44L176 12L192 60L208 28L224 44L240 32L260 36" fill="none" stroke="currentColor" opacity=".3" />
				<path d="M0 36L16 28L32 44L48 14L64 58L80 28L96 44L112 14L128 58L144 28L160 44L176 14L192 58L208 28L224 44L240 32L260 36" fill="none" stroke="currentColor" strokeWidth="2" />
			</svg></>;
		};
	}, [copy]);
	return <MenuTooltipProvider resolve={resolve} resolveShortcut={resolveShortcut}>{children}</MenuTooltipProvider>;
}
