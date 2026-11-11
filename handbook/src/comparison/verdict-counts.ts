export const VERDICTS = {
	yes: { marker: '+', label: 'Supported' },
	partial: { marker: '~', label: 'Limited' },
	no: { marker: '/', label: 'Unavailable' },
	unknown: { marker: '?', label: 'Not verified' },
} as const;

export type Verdict = keyof typeof VERDICTS;
export type VerdictCounts = Readonly<Record<Verdict, number>>;
export const VERDICT_STATES = Object.keys(VERDICTS) as Verdict[];

export function parseVerdictRow(markers: string, columns: number): readonly Verdict[] {
	if (markers.length !== columns) throw new Error('Comparison column count does not match its verdicts.');
	return [...markers].map(marker => {
		const state = VERDICT_STATES.find(state => VERDICTS[state].marker === marker);
		if (!state) throw new Error(`Invalid comparison verdict: ${marker}`);
		return state;
	});
}

/** Index n contains the counts after n rows, so reverse scrolling needs no undo bookkeeping. */
export function createVerdictLedger(rows: readonly (readonly Verdict[])[], columns: number): readonly (readonly VerdictCounts[])[] {
	const ledger: VerdictCounts[][] = [Array.from({ length: columns }, () => ({ yes: 0, partial: 0, no: 0, unknown: 0 }))];
	for (const row of rows) {
		if (row.length !== columns) throw new Error('Comparison column count does not match its verdicts.');
		const previous = ledger[ledger.length - 1]!;
		ledger.push(row.map((state, index) => ({ ...previous[index]!, [state]: previous[index]![state] + 1 })));
	}
	return ledger;
}

export function passedRowCount(bottoms: readonly number[], line: number): number {
	let low = 0, high = bottoms.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (bottoms[middle]! <= line) low = middle + 1;
		else high = middle;
	}
	return low;
}
