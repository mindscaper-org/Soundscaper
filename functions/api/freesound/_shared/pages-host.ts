/* SPDX-License-Identifier: AGPL-3.0-only */

/** Admit only the application's current and retained Pages project hostnames. */
export function isFreesoundPagesHost(hostname: string): boolean {
	return ['soundscaper-5ki.pages.dev', 'soundscaper.pages.dev'].some(project => hostname === project || hostname.endsWith(`.${project}`));
}
