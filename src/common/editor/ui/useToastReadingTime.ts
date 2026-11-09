/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useEffectEvent, useRef, type FocusEvent } from 'react';
import { createToastCountdown } from '../controller/composition/toast-countdown.ts';

export function useToastReadingTime(id: string, enabled: boolean, onDismiss: (() => void) | undefined) {
	const expire = useEffectEvent(() => onDismiss?.());
	const countdown = useRef<ReturnType<typeof createToastCountdown<ReturnType<typeof setTimeout>>> | null>(null);
	const interaction = useRef({ hover: false, focus: false });
	useEffect(() => {
		if (!enabled) return;
		const timer = createToastCountdown({ duration: 10_000, now: Date.now,
			schedule: (callback, delay) => setTimeout(callback, delay), cancel: clearTimeout, onExpire: expire });
		countdown.current = timer;
		timer.setPaused(interaction.current.hover || interaction.current.focus);
		return () => { timer.dispose(); countdown.current = null; };
	}, [id, enabled]);
	const pause = (kind: 'hover' | 'focus', active: boolean) => {
		interaction.current[kind] = active;
		countdown.current?.setPaused(interaction.current.hover || interaction.current.focus);
	};
	return {
		onMouseEnter: () => pause('hover', true), onMouseLeave: () => pause('hover', false),
		onFocus: () => pause('focus', true),
		onBlur: (event: FocusEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget)) pause('focus', false); },
	};
}
