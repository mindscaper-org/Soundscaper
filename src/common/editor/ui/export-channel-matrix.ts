/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The checkbox matrix behind Audacity's custom channel mapping.
 *
 * A mapping is a list of output channels, each naming the input channels that
 * feed it and at what gain. The matrix editor states routing only, so every
 * newly checked cell is unity gain and every unchecked one is absent. Existing
 * contributions retain their gains until that route is edited, so reviewing
 * the grid or editing another route never rewrites attenuation or polarity.
 */

export const MAXIMUM_EXPORT_CHANNELS = 32;

type DataRecord = Readonly<Record<string, unknown>>;

/** `matrix[input][output]` — a row per delivered input, a column per output. */
export type ExportChannelMatrix = readonly (readonly boolean[])[];

export function exportChannelMatrixOutputCount(matrix: ExportChannelMatrix): number {
	return matrix[0]?.length ?? 0;
}

/**
 * Read one mapping into the grid, falling back to an identity routing.
 *
 * An empty or unreadable mapping is not an error here: the operator is opening
 * the editor to write one, and the identity routing is the mapping the delivery
 * would have made without them.
 */
export function parseExportChannelMatrix(
	value: unknown,
	inputChannelCount: number,
): ExportChannelMatrix {
	const inputs = boundedExportChannelCount(inputChannelCount, 2);
	const channels = readOutputChannels(value);
	if (!channels) return identityExportChannelMatrix(inputs);
	const outputs = boundedExportChannelCount(channels.length, inputs);
	const matrix = Array.from({ length: inputs }, () => Array.from({ length: outputs }, () => false));
	for (const [outputIndex, channel] of channels.slice(0, outputs).entries()) {
		for (const input of readInputs(channel)) {
			if (input.channel < inputs && input.gain !== 0) matrix[input.channel][outputIndex] = true;
		}
	}
	return freezeMatrix(matrix);
}

export function identityExportChannelMatrix(inputChannelCount: number): ExportChannelMatrix {
	const inputs = boundedExportChannelCount(inputChannelCount, 2);
	return freezeMatrix(Array.from({ length: inputs }, (_, input) => (
		Array.from({ length: inputs }, (__, output) => input === output)
	)));
}

/**
 * Widen the grid to hold at least this many outputs, never narrowing it.
 *
 * The output count is typed a digit at a time, so trimming the grid to match it
 * would delete the routing of every column past the first digit before the
 * second one arrived. The count decides what is shown and delivered; the grid
 * only ever remembers more than that.
 */
export function ensureExportChannelMatrixWidth(
	matrix: ExportChannelMatrix,
	outputChannelCount: number,
): ExportChannelMatrix {
	const currentOutputs = exportChannelMatrixOutputCount(matrix);
	const outputs = Math.max(boundedExportChannelCount(outputChannelCount, currentOutputs), currentOutputs);
	if (outputs === currentOutputs) return matrix;
	return freezeMatrix(matrix.map((row) => Array.from(
		{ length: outputs },
		(_, output) => row[output] ?? false,
	)));
}

/** The output count a stepper's text means, kept inside the delivered bounds. */
export function boundedExportChannelCount(value: unknown, fallback: number): number {
	const count = Number(value);
	if (!Number.isSafeInteger(count) || count < 1) return fallback;
	return Math.min(count, MAXIMUM_EXPORT_CHANNELS);
}

export function toggleExportChannelMatrix(
	matrix: ExportChannelMatrix,
	input: number,
	output: number,
	checked: boolean,
): ExportChannelMatrix {
	return Object.freeze(matrix.map((row, rowIndex) => rowIndex === input
		? Object.freeze(row.map((cell, cellIndex) => cellIndex === output ? checked : cell))
		: Object.isFrozen(row) ? row : Object.freeze([...row])));
}

/** The mapping the grid means, in the shape the export request already parses. */
export function serializeExportChannelMatrix(
	matrix: ExportChannelMatrix,
	outputChannelCount: number = exportChannelMatrixOutputCount(matrix),
	baseline?: unknown,
	editedCells: ReadonlySet<string> = new Set(),
): string {
	const outputs = boundedExportChannelCount(outputChannelCount, exportChannelMatrixOutputCount(matrix));
	const original = readOutputChannels(baseline);
	return `${JSON.stringify({
		channels: Array.from({ length: outputs }, (_, output) => {
			const originalInputs = new Map<number, Readonly<{ channel: number; gain: number }>[]>();
			for (const contribution of readInputs(original?.[output])) {
				const retained = originalInputs.get(contribution.channel);
				if (retained) retained.push(contribution);
				else originalInputs.set(contribution.channel, [contribution]);
			}
			return { inputs: matrix.flatMap((row, input) => {
				if (!row[output]) return [];
				const retained = editedCells.has(`${String(input)}-${String(output)}`) ? []
					: originalInputs.get(input) ?? [];
				return retained.length ? retained : [{ channel: input, gain: 1 }];
			}) };
		}),
	}, null, 2)}\n`;
}

function readOutputChannels(value: unknown): readonly unknown[] | null {
	const parsed = typeof value === 'string' ? parseJson(value) : value;
	const channels = Array.isArray(parsed) ? parsed : (parsed as DataRecord | null)?.channels;
	return Array.isArray(channels) && channels.length > 0 ? channels : null;
}

function parseJson(text: string): unknown {
	try { return JSON.parse(text.trim()); } catch { return null; }
}

/**
 * Read one output channel the way the export request reads it.
 *
 * The request accepts three spellings, and they mean different things: a bare
 * integer is the single input feeding the output, a bare array is one gain per
 * input channel, and a record states the feeding inputs one by one. Reading a
 * bare array as a list of input indices instead would show the operator a grid
 * that is not the mapping they hold, and applying it would deliver that grid.
 */
function readInputs(channel: unknown): readonly Readonly<{ channel: number; gain: number }>[] {
	if (typeof channel === 'number') {
		return Number.isSafeInteger(channel) && channel >= 0 ? [{ channel, gain: 1 }] : [];
	}
	if (Array.isArray(channel)) {
		return channel.flatMap((value, input) => {
			const gain = Number(value);
			return Number.isFinite(gain) ? [{ channel: input, gain }] : [];
		});
	}
	const inputs = Array.isArray((channel as DataRecord | null)?.inputs)
		? (channel as Readonly<{ inputs: readonly unknown[] }>).inputs
		: [];
	return inputs.flatMap((value) => {
		const record = value as DataRecord | null;
		const channelIndex = Number(record?.channel);
		if (!Number.isSafeInteger(channelIndex) || channelIndex < 0) return [];
		const gain = Number(record?.gain ?? 1);
		return [{ channel: channelIndex, gain: Number.isFinite(gain) ? gain : 1 }];
	});
}

function freezeMatrix(matrix: readonly (readonly boolean[])[]): ExportChannelMatrix {
	return Object.freeze(matrix.map((row) => Object.freeze([...row])));
}
