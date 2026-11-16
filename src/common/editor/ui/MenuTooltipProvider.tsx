/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '@soundscaper/design-system/ThemeProvider';
import { retainTooltipDescription } from '@soundscaper/design-system/utils/retain-tooltip-description';
import { withinHelpTooltipPointerPath } from './help-tooltip-pointer-path.ts';
import { menuTooltipPosition } from './menu-tooltip-position.ts';
import './menu-tooltip.css';

const ITEM = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], .menu__item';
const HOVER_DELAY = 450;

export type MenuTooltipResolver = (label: string, id: string) => ReactNode;
interface Explanation { readonly target: HTMLElement; readonly content: ReactNode }

function menuItem(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element ? target.closest<HTMLElement>(ITEM) : null;
}

function explanationFor(target: HTMLElement, resolve: MenuTooltipResolver): Explanation | null {
	// A top-level menu's open sheet already occupies the space beside its trigger.
	if (target.closest('[role="menubar"]') && target.getAttribute('aria-expanded') === 'true') return null;
	const label = target.querySelector('.context-menu-item-label, .menu__label') ?? target;
	const marker = target.hasAttribute('data-menu-tooltip-id') ? target : label.querySelector<HTMLElement>('[data-menu-tooltip-id], [data-action-id]') ?? target;
	const id = marker.getAttribute('data-menu-tooltip-id') ?? marker.getAttribute('data-action-id') ?? '';
	const content = resolve(label.getAttribute('aria-label') ?? label.textContent ?? '', id);
	const reason = label.querySelector<HTMLElement>('[data-disabled-reason]')?.getAttribute('data-disabled-reason');
	return content ? { target, content: <>{content}{reason && <p className="menu-tooltip__reason">{reason}</p>}</> } : null;
}

/** One delegated lifecycle covers nested menus, portaled menus, and disabled entries. */
export function MenuTooltipProvider({ children, resolve }: {
	readonly children: ReactNode;
	readonly resolve: MenuTooltipResolver;
}) {
	const [explanation, setExplanation] = useState<Explanation | null>(null);
	const surfaceRef = useRef<HTMLDivElement>(null);
	const tooltipId = useId();
	useEffect(() => {
		setExplanation(null);
		let timer: ReturnType<typeof setTimeout> | undefined;
		let active: Explanation | null = null;
		let pending: HTMLElement | null = null;
		let keyboard = false;
		const cancelPending = () => { clearTimeout(timer); pending = null; };
		const dismiss = () => { cancelPending(); active = null; observer.disconnect(); setExplanation(null); };
		const show = (next: Explanation) => {
			cancelPending();
			if (!next.target.isConnected) return;
			active = next;
			observer.observe(document.body, { childList: true, subtree: true });
			setExplanation(next);
		};
		const over = (event: PointerEvent) => {
			if (event.pointerType === 'touch' || surfaceRef.current?.contains(event.target as Node)) return;
			keyboard = false;
			const target = menuItem(event.target);
			if (!target || target === active?.target || target === pending) return;
			dismiss();
			const next = explanationFor(target, resolve);
			if (!next) return;
			pending = target;
			timer = setTimeout(() => show(next), HOVER_DELAY);
		};
		const out = (event: PointerEvent) => {
			if (pending && !pending.contains(event.relatedTarget as Node)) cancelPending();
			if (active && !event.relatedTarget) dismiss();
		};
		const move = (event: PointerEvent) => {
			if (!active || keyboard) return;
			const surface = surfaceRef.current;
			if (surface && !withinHelpTooltipPointerPath(event, active.target.getBoundingClientRect(), surface.getBoundingClientRect())) dismiss();
		};
		const key = () => { keyboard = true; dismiss(); };
		const focus = (event: FocusEvent) => {
			const target = menuItem(event.target);
			if (!target?.closest('[role="menu"]') || (!keyboard && !target.matches(':focus-visible'))) return;
			keyboard = true;
			const next = target && explanationFor(target, resolve);
			if (next) show(next);
		};
		const blur = (event: FocusEvent) => { if (active?.target === event.target) dismiss(); };
		const changed = () => { if (active && !active.target.isConnected) dismiss(); };
		const observer = new MutationObserver(changed);
		document.addEventListener('pointerover', over);
		document.addEventListener('pointerout', out);
		document.addEventListener('pointermove', move);
		document.addEventListener('pointerdown', dismiss, true);
		document.addEventListener('keydown', key, true);
		document.addEventListener('focusin', focus);
		document.addEventListener('focusout', blur);
		window.addEventListener('blur', dismiss);
		return () => {
			cancelPending();
			observer.disconnect();
			document.removeEventListener('pointerover', over);
			document.removeEventListener('pointerout', out);
			document.removeEventListener('pointermove', move);
			document.removeEventListener('pointerdown', dismiss, true);
			document.removeEventListener('keydown', key, true);
			document.removeEventListener('focusin', focus);
			document.removeEventListener('focusout', blur);
			window.removeEventListener('blur', dismiss);
		};
	}, [resolve]);
	return <>{children}{explanation && <MenuTooltipSurface explanation={explanation} id={tooltipId} surfaceRef={surfaceRef} />}</>;
}

function MenuTooltipSurface({ explanation, id, surfaceRef }: {
	readonly explanation: Explanation;
	readonly id: string;
	readonly surfaceRef: React.RefObject<HTMLDivElement | null>;
}) {
	const { theme } = useTheme();
	useLayoutEffect(() => {
		const surface = surfaceRef.current;
		const { target } = explanation;
		if (!surface) return;
		const releaseDescription = retainTooltipDescription(target, id);
		const position = () => {
			const anchor = target.getBoundingClientRect();
			// Leave an open child menu unobscured; child entries get their own help.
			const submenu = target.querySelector(':scope > .context-menu-submenu')?.getBoundingClientRect();
			const bounds = submenu ? { ...anchor, left: Math.min(anchor.left, submenu.left), right: Math.max(anchor.right, submenu.right), top: anchor.top, bottom: anchor.bottom } : anchor;
			const next = menuTooltipPosition(bounds, surface.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
			surface.style.left = `${next.left}px`;
			surface.style.top = `${next.top}px`;
			surface.dataset.side = next.side;
		};
		position();
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
		observer?.observe(surface);
		observer?.observe(target);
		window.addEventListener('resize', position);
		document.addEventListener('scroll', position, true);
		return () => {
			releaseDescription();
			observer?.disconnect();
			window.removeEventListener('resize', position);
			document.removeEventListener('scroll', position, true);
		};
	}, [explanation, id, surfaceRef]);
	return createPortal(<div ref={surfaceRef} id={id} role="tooltip" className="menu-tooltip" style={{
		background: theme.background.menu.background, color: theme.foreground.text.primary, borderColor: theme.border.default,
	}}>{explanation.content}</div>, document.body);
}
