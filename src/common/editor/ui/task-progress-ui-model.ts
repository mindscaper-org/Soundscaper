/* SPDX-License-Identifier: AGPL-3.0-only */

export interface TaskProgressViewModel {
	readonly id: string;
	readonly kind: string;
	readonly label: string;
	readonly value: number | null;
	readonly cancellable?: boolean;
}

export interface TaskProgressBusySnapshot {
	readonly projectActivationPending?: unknown;
	readonly projectAdministrationPending?: unknown;
	readonly importing?: unknown;
	readonly exporting?: unknown;
	readonly processingEffect?: unknown;
	readonly analysisProcessing?: unknown;
	readonly playbackOptions?: Readonly<{ preparing?: unknown }> | null;
	readonly sampleEdit?: Readonly<{ processing?: unknown }> | null;
}

/** Continuous recording and read-only projects do not make background work modal. */
export function selectTaskProgressPresentation(snapshot: TaskProgressBusySnapshot): 'dialog' | 'toast' {
	return snapshot.projectActivationPending || snapshot.projectAdministrationPending
		|| snapshot.importing || snapshot.exporting || snapshot.processingEffect
		|| snapshot.analysisProcessing || snapshot.sampleEdit?.processing || snapshot.playbackOptions?.preparing
		? 'dialog' : 'toast';
}

export function selectFallbackTaskProgress(
	snapshot: TaskProgressBusySnapshot,
	label: string,
): TaskProgressViewModel | null {
	const kind = snapshot.importing
		? 'import'
		: snapshot.exporting
			? 'export'
			: snapshot.processingEffect
				? 'effect'
				: snapshot.analysisProcessing
					? 'analysis'
					: snapshot.sampleEdit?.processing
						? 'sample-edit'
						: snapshot.playbackOptions?.preparing ? 'render' : null;
	return kind ? Object.freeze({ id: `busy-${kind}`, kind, label, value: null }) : null;
}
