/* SPDX-License-Identifier: AGPL-3.0-only */

import { useContext, useSyncExternalStore, useEffect, useRef, type ContextType, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { LightscaperPhotoBackendContextCurrentV1 } from './photo-library-backend-context-current-v1.ts';
import type { LightscaperPhotoBackendCurrentV1 as Backend } from '../../controller/composition/lightscaper-photo-backend-switch-current-v1.ts';
import { lightscaperPhotoBackendCopyCurrentV1 } from '../../../i18n/lightscaper-photo-backend-copy-current-v1.ts';

export default function PhotoLibraryBackendMenuCurrentV1({ locale }: Readonly<{ locale: string }>) {
	const owner = useContext(LightscaperPhotoBackendContextCurrentV1);
	if (!owner) return null;
	return <BackendMenu owner={owner} locale={locale} />;
}
function BackendMenu({ owner, locale }: Readonly<{ owner: NonNullable<ContextType<typeof LightscaperPhotoBackendContextCurrentV1>>; locale: string }>) {
	const snapshot = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot), copy = lightscaperPhotoBackendCopyCurrentV1(locale);
	const focusAfterSwitch = useRef(false), target = snapshot.target instanceof HTMLElement ? snapshot.target : null;
	const disabled = !snapshot.ready || snapshot.busy || snapshot.failed || snapshot.safety !== 'ready';
	useEffect(() => {
		if (!focusAfterSwitch.current || !target || !snapshot.ready || snapshot.busy) return;
		focusAfterSwitch.current = false; target.querySelector<HTMLElement>(`[data-photo-backend-choice="${snapshot.backend}"]`)?.focus();
	}, [target, snapshot.ready, snapshot.busy, snapshot.backend]);
	if (!snapshot.nativeAvailable || !target) return null;
	const select = (backend: Backend, keyboard: boolean): void => {
		if (disabled || backend === snapshot.backend) return;
		focusAfterSwitch.current = keyboard;
		void owner.select(backend).then(changed => { if (!changed) focusAfterSwitch.current = false; }, () => { window.alert?.(copy.photoBackendFailed); });
	};
	const keyDown = (event: KeyboardEvent<HTMLButtonElement>, backend: Backend): void => {
		let next: Backend | undefined;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'Home') next = 'web';
		if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'End') next = 'native';
		if (event.key === ' ' || event.key === 'Enter') next = backend;
		if (!next) return; event.preventDefault(); event.stopPropagation();
		if (next === snapshot.backend) target.querySelector<HTMLElement>(`[data-photo-backend-choice="${next}"]`)?.focus();
		else select(next, true);
	};
	return createPortal(<details className="lightscaper-photo-submenu" data-photo-backend-menu>
		<summary className="application-header__menu-item">{copy.photoBackendTitle}</summary>
		<div className="lightscaper-menu-items" role="radiogroup" aria-label={copy.photoBackendTitle}>
			{(['web', 'native'] as const).map(backend => <button key={backend} type="button" role="radio" data-photo-backend-choice={backend}
				aria-checked={snapshot.backend === backend} disabled={disabled} tabIndex={snapshot.backend === backend ? 0 : -1}
				title={disabled ? copy.photoBackendUnavailable : undefined} onClick={() => select(backend, false)} onKeyDown={event => keyDown(event, backend)}>
				{snapshot.backend === backend ? <span aria-hidden="true">✓ </span> : null}{backend === 'web' ? copy.photoBackendWeb : copy.photoBackendNative}</button>)}
			<p className="application-header__menu-hint">{copy.photoBackendExplanation}</p>
		</div>
	</details>, target);
}
