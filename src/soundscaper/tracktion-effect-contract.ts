/* SPDX-License-Identifier: AGPL-3.0-only */

export interface TracktionEffectSlot {
	readonly id: string;
	readonly name: string;
	readonly format: string;
}

export interface TracktionEffectPage {
	readonly revision: number;
	readonly slots: readonly TracktionEffectSlot[];
	readonly nextOffset: number | null;
}

export interface TracktionEffectInstallation extends TracktionEffectSlot {
	readonly vendor: string;
	readonly allowed: boolean;
}

type Track = Readonly<{ revision: number; trackId: string }>;

export type TracktionEffectEdit = Track & (
	| Readonly<{ kind: 'offlineEffects'; offset: number }>
	| Readonly<{ kind: 'removeOfflineEffect'; slotId: string }>
);

export type TracktionEffectCommand = TracktionEffectEdit
	| Readonly<{ kind: 'offlineEffectCatalog' }>
	| Readonly<{ kind: 'scanOfflineEffects' }>
	| (Track & Readonly<{ kind: 'addOfflineEffect'; installationId: string }>);
