/* SPDX-License-Identifier: AGPL-3.0-only */
import { admBedSpeakers, admBedLayoutDefinition } from '../adm-bed-layout.ts';
import type { AdmAuthoredMetadata } from '../adm-project-metadata.ts';
import type { EarGainCalculator } from './gain-calculator.ts';

/** Static point objects have diffuse=0; no decorrelator or delay is required. */
export function renderEarProgramme(
	metadata: AdmAuthoredMetadata,
	channels: readonly Float32Array[],
	calculator: EarGainCalculator,
): readonly Float32Array<ArrayBuffer>[] {
	const speakers = admBedSpeakers(metadata.bed.layout);
	const objects = metadata.objects ?? [];
	if (channels.length !== speakers.length + objects.length) throw new RangeError('The EBU EAR source channel count does not match its programme.');
	const frames = channels[0]?.length ?? 0;
	if (channels.some((channel) => channel.length !== frames)) throw new RangeError('The EBU EAR source channels must have equal length.');
	const output = Array.from({ length: calculator.channelCount }, () => new Float32Array(frames));
	const pack = admBedLayoutDefinition(metadata.bed.layout).packRef;
	for (let source = 0; source < channels.length; source += 1) {
		const gains = source < speakers.length
			? calculator.direct(speakers[source]!, pack)
			: calculator.object(objects[source - speakers.length]!.position);
		for (let destination = 0; destination < output.length; destination += 1) {
			const gain = gains[destination]!;
			if (gain === 0) continue;
			const input = channels[source]!;
			const target = output[destination]!;
			for (let frame = 0; frame < frames; frame += 1) target[frame] = target[frame]! + input[frame]! * gain;
		}
	}
	return output;
}
