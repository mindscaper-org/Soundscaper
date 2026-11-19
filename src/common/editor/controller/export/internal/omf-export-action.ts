/* SPDX-License-Identifier: AGPL-3.0-only */

import { exportEmbeddedAudioInterchange } from './embedded-audio-interchange-export-action.ts';
import type { ExportActionGroupRuntime } from '../export-action-group.ts';
import type { DeliveryReportState } from '../export-state.ts';

export function exportProjectOmf(runtime: ExportActionGroupRuntime & Readonly<{ state: DeliveryReportState }>, sequenceId?: string) {
	return exportEmbeddedAudioInterchange(runtime, 'omf', sequenceId);
}
