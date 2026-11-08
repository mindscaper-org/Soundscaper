/* SPDX-License-Identifier: AGPL-3.0-only */

export default function LazyInspectorFallback({ copy }: Readonly<{
	copy: Readonly<{ loading: string }>;
}>) {
	return <span className="kw-audio-editor-sr-only" role="status" aria-live="polite">{copy.loading}</span>;
}
