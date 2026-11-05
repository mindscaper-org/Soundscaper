/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiFileDocument } from '../../../midi-file-types.ts';
import { midiFileDeliveryReport } from '../../../midi-file-delivery-report.ts';
import type { MidiServiceDependencies } from '../midi-service-types.ts';

export async function deliverMidiFile(dependencies: Pick<MidiServiceDependencies, 'saveFile' | 'publishDeliveryReport'>,
	document: MidiFileDocument, format: 'midi' | 'allegro', name: string, isCurrent: () => boolean): Promise<unknown> {
	const request = format === 'midi' ? { purpose: 'interchange', bytes: (await import('../../../midi-file.ts')).writeMidiFile(document),
		mimeType: 'audio/midi', suggestedName: `${name}.mid`, extensions: ['mid', 'midi'] }
		: { purpose: 'interchange', text: (await import('../../../allegro-file.ts')).writeAllegroFile(document),
			mimeType: 'text/plain', suggestedName: `${name}.gro`, extensions: ['gro'] };
	const report = midiFileDeliveryReport(document, format);
	const result: unknown = await dependencies.saveFile(request);
	const canceled = result !== null && typeof result === 'object' && 'cancelled' in result && result.cancelled === true;
	if (!canceled && isCurrent()) dependencies.publishDeliveryReport?.(report);
	return result;
}
