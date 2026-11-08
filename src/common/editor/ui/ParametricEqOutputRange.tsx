/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type PointerEvent } from 'react';
import { retainNativeRangeMouseCustody } from '../controller/effects/native-range-mouse-custody.ts';
import { useNativeRangeTouchOwner } from './useNativeRangeTouchOwner.ts';

interface ParametricEqOutputRangeProps {
	readonly disabled: boolean;
	readonly value: number;
	readonly minimum: number;
	readonly maximum: number;
	readonly onBegin: () => void;
	readonly onValueChange: (value: number) => void;
	readonly onFinish: () => void;
	readonly onCancel: () => void;
	readonly onReset: () => void;
}

const RANGE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

export function ParametricEqOutputRange({ disabled, value, minimum, maximum, onBegin,
	onValueChange, onFinish, onCancel, onReset }: ParametricEqOutputRangeProps) {
	const owner = useRef<number | null>(null);
	const canceled = useRef(false), keyboard = useRef(false);
	const input = useNativeRangeTouchOwner();
	const mouseCustody = useRef<(() => void) | null>(null);
	const callbacks = useRef({ onFinish, onCancel });
	callbacks.current = { onFinish, onCancel };
	const retireMouse = (): void => { mouseCustody.current?.(); mouseCustody.current = null; };
	useEffect(() => () => { mouseCustody.current?.(); mouseCustody.current = null; owner.current = null; }, []);
	const finishMouse = (cancel: boolean): void => {
		const pointer = owner.current;
		owner.current = null;
		canceled.current = cancel; keyboard.current = false;
		retireMouse();
		if (pointer !== null && input.current?.hasPointerCapture?.(pointer)) input.current.releasePointerCapture(pointer);
		if (cancel) callbacks.current.onCancel(); else callbacks.current.onFinish();
	};
	const finish = (event: PointerEvent<HTMLInputElement>, cancel: boolean): void => {
		if (owner.current !== event.pointerId) return;
		owner.current = null;
		canceled.current = cancel; keyboard.current = false;
		retireMouse();
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
		if (cancel) onCancel(); else onFinish();
	};
	return <input ref={input} disabled={disabled} type="range" min={minimum} max={maximum} step="0.1" value={value}
		onPointerDown={event => {
			if (disabled || event.button !== 0) return;
			if (event.isPrimary === false || owner.current !== null) { event.preventDefault(); return; }
			owner.current = event.pointerId;
			canceled.current = false; keyboard.current = false;
			onBegin();
			if (event.pointerType === 'mouse') {
				mouseCustody.current = retainNativeRangeMouseCustody(event.currentTarget.ownerDocument, event.pointerId, {
					finish: () => finishMouse(false), cancel: () => finishMouse(true),
				});
			} else event.currentTarget.setPointerCapture?.(event.pointerId);
		}}
		onChange={event => { if (!canceled.current) onValueChange(Number(event.currentTarget.value)); }}
		onPointerMove={event => {
			if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) finish(event, false);
		}}
		onPointerUp={event => finish(event, false)}
		onPointerCancel={event => finish(event, true)}
		onLostPointerCapture={event => finish(event, true)}
		onKeyDown={event => {
			if (event.key === 'Escape' && (owner.current !== null || keyboard.current)) {
				event.preventDefault(); event.stopPropagation(); finishMouse(true);
			} else if (RANGE_KEYS.includes(event.key) && owner.current === null) {
				if (canceled.current && event.repeat) { event.preventDefault(); return; }
				canceled.current = false; keyboard.current = true; onBegin();
			}
		}}
		onKeyUp={event => { if (RANGE_KEYS.includes(event.key) && owner.current === null && !canceled.current) { keyboard.current = false; onFinish(); } }}
		onBlur={() => { owner.current = null; keyboard.current = false; retireMouse(); if (!canceled.current) onFinish(); }}
		onDoubleClick={event => {
			if (disabled) return;
			event.preventDefault(); event.stopPropagation();
			owner.current = null; retireMouse(); onFinish(); onReset();
		}}
	/>;
}
