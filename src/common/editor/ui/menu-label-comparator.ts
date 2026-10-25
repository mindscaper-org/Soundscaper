/* SPDX-License-Identifier: AGPL-3.0-only */

/** A locale comparator belongs to one menu sort; empty lists retain lazy locale validation. */
export function menuLabelComparator(locale?: string): (left: { readonly label?: string }, right: { readonly label?: string }) => number {
	let collator: Intl.Collator | undefined;
	return (left, right) => (collator ??= new Intl.Collator(locale || 'en')).compare(left.label ?? '', right.label ?? '');
}
