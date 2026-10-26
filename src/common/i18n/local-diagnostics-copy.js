/* SPDX-License-Identifier: AGPL-3.0-only */

const ENTRIES = Object.freeze([
	['localDiagnosticsTitle', 'Local Diagnostics'],
	['localDiagnosticsPrivacy', 'The report stays on this device unless you explicitly export it. It contains no project names, identifiers, file paths, media, transcripts, error messages, or stacks.'],
	['localDiagnosticsGenerate', 'Generate local diagnostic report'],
	['localDiagnosticsGenerating', 'Generating report'],
	['localDiagnosticsExport', 'Export local diagnostic report'],
	['localDiagnosticsExporting', 'Exporting report'],
	['localDiagnosticsSaved', 'The local diagnostic report was exported.'],
	['localDiagnosticsError', 'The local diagnostic report could not be created or exported.'],
	['localDiagnosticsVersions', 'Versions'],
	['localDiagnosticsEnvironment', 'Environment'],
	['localDiagnosticsCapabilities', 'Capabilities'],
	['localDiagnosticsErrors', 'Recent typed errors'],
	['localDiagnosticsStorage', 'Storage and library'],
	['localDiagnosticsRecovery', 'Recovery journals'],
	['localDiagnosticsStreaming', 'Streamed playback'],
	['localDiagnosticsStreamingSummary', '{observation}; {frames} underrun frames.'],
	['localDiagnosticsStreamingObserved', 'observed'],
	['localDiagnosticsStreamingNotObserved', 'not observed'],
	['localDiagnosticsVersionSummary', '{application}; diagnostics schema {diagnostics}; Scape {scape}.'],
	['localDiagnosticsCapabilitySummary', '{available} of {total} capabilities available.'],
	['localDiagnosticsErrorSummary', '{count} recent typed errors retained.'],
	['localDiagnosticsLibrarySummary', '{projects} projects in the library; {open} open.'],
]);

export const LOCAL_DIAGNOSTICS_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
});
