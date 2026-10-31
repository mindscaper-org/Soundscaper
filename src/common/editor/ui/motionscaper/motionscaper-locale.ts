/* SPDX-License-Identifier: AGPL-3.0-only */
import { validateMotionDesktopLocale, type MotionDesktopLocale } from '../../../../motionscaper/desktop-locale-contract.ts';
export function motionscaperDesktopLocale(): MotionDesktopLocale | null {
	const scope = globalThis as typeof globalThis & { scapeDesktop?: { v1?: { motionLocale?: MotionDesktopLocale } } };
	const bridge = scope.scapeDesktop?.v1?.motionLocale; return typeof bridge?.set === 'function' ? bridge : null;
}
/** Publish new UI copy only after the private preference is durably accepted. No navigation occurs. */
export async function changeMotionscaperDesktopLocale(bridge: MotionDesktopLocale, value: string, changed: (locale: string) => void): Promise<void> {
	const locale = validateMotionDesktopLocale(value), accepted = validateMotionDesktopLocale(await bridge.set(locale));
	if (accepted !== locale) throw new Error('Motionscaper persisted a different locale.');
	changed(accepted);
}
