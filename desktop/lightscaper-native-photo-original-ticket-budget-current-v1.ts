/* SPDX-License-Identifier: AGPL-3.0-only */

/** A scope's singles and whole groups share admission work, Photo authority
 * slots and independently materialized encoded bytes. Physical namespace pins
 * remain a separate, stronger capacity boundary in the actual Media owner. */
export interface LightscaperNativePhotoOriginalTicketBudgetCurrentV1 { work: number; tickets: number; bytes: number }
const budgets = new WeakMap<AbortSignal, LightscaperNativePhotoOriginalTicketBudgetCurrentV1>();
export function lightscaperNativePhotoOriginalTicketBudgetCurrentV1(signal: AbortSignal): LightscaperNativePhotoOriginalTicketBudgetCurrentV1 {
	const value = budgets.get(signal) ?? { work: 0, tickets: 0, bytes: 0 }; budgets.set(signal, value); return value;
}
