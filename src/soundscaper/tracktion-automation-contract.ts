/* SPDX-License-Identifier: AGPL-3.0-only */

export const TRACKTION_AUTOMATION_RANGES = { gainDb: [-100, 6], pan: [-1, 1] } as const;

export type TracktionAutomationParameter = keyof typeof TRACKTION_AUTOMATION_RANGES;

export interface TracktionAutomationPoint {
	readonly frame: number;
	readonly value: number;
	readonly curve: number;
}

export interface TracktionAutomationPage {
	readonly revision: number;
	readonly points: readonly TracktionAutomationPoint[];
	readonly nextOffset: number | null;
}

export type TracktionAutomationEdit = Readonly<{ parameter: TracktionAutomationParameter }> & (
	| (Readonly<{ kind: 'setAutomationPoint'; index: number | null }> & TracktionAutomationPoint)
	| Readonly<{ kind: 'removeAutomationPoint'; index: number }>
	| Readonly<{ kind: 'clearAutomation' }>
);

export type TracktionAutomationQuery = Readonly<{ kind: 'trackAutomation'; parameter: TracktionAutomationParameter; offset: number }>;

export type TracktionAutomationCommand = Readonly<{ revision: number; trackId: string }> & (
	TracktionAutomationQuery | TracktionAutomationEdit
);

export function isTracktionAutomationParameter(value: unknown): value is TracktionAutomationParameter {
	return value === 'gainDb' || value === 'pan';
}

export function isTracktionAutomationValue(value: unknown, [minimum, maximum]: readonly [number, number]): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}
