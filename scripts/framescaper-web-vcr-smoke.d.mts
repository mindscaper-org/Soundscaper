/* SPDX-License-Identifier: AGPL-3.0-only */

export function runFramescaperWebVcrPackagedSmoke(options: {
	readonly executable: string;
}): Promise<Readonly<Record<string, unknown>>>;
