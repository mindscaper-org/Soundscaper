/* SPDX-License-Identifier: AGPL-3.0-only */
import { REPORT_ITEM_COPY } from './editor-report-item-copy.ts';

/**
 * Copy for the two report surfaces.
 *
 * Delivery reports generalize the AUP4 compatibility report's vocabulary, so
 * both sets of strings live together: the disposition labels are literally
 * shared by the two renderers, and splitting them across files is how one of
 * them ends up translated and the other not.
 */
const REPORT_COPY_ENTRIES = Object.freeze([
	['projectCompatibilityReport', 'Project compatibility report'],
	['aup3CompatibilityReport', 'AUP3 Compatibility Report'],
	['aup3CompatibilityDescription', 'AUP3 is an Audacity 3 project format. The local Soundscaper project remains the authoritative, fully editable version.'],
	['aup3CompatibilityOpen', 'AUP3 open'],
	['aup3CompatibilitySave', 'AUP3 export'],
	['aup4CompatibilityReport', 'AUP4 Compatibility Report'],
	['aup4CompatibilityDescription', 'AUP4 is an Audacity interchange format. The local Soundscaper project remains the authoritative, fully editable version.'],
	['aup4CompatibilitySummary', '{direction}: {converted} converted, {missing} missing, {omitted} omitted.'],
	['aup4CompatibilityOpen', 'AUP4 open'],
	['aup4CompatibilitySave', 'AUP4 export'],
	['aup4CompatibilityViewReport', 'View report'],
	['aup4CompatibilityDismiss', 'Dismiss compatibility summary'],
	['aup4CompatibilityNoIssues', 'No compatibility losses were reported for this interchange.'],
	['aup4CompatibilityPreserved', 'Preserved'],
	['aup4CompatibilityConverted', 'Converted'],
	['aup4CompatibilityMissing', 'Missing'],
	['aup4CompatibilityOmitted', 'Omitted'],
	['aup4CompatibilityDetails', 'Details'],
	['deliveryReport', 'Delivery Report'],
	['deliveryReportSummary', '{format}: {converted} converted, {omitted} omitted.'],
	['deliveryReportSubject', '{format}, {sampleRate} Hz, {channels} ch'],
	['deliveryReportSave', 'Save report'],
	['deliveryPreset', 'Preset'],
	['deliveryPresetNone', 'Custom'],
	['deliveryPresetName', 'Preset name'],
	['deliveryPresetSave', 'Save preset'],
	['deliveryPresetDelete', 'Delete preset'],
	['deliveryPresetImport', 'Import presets'],
	['deliveryPresetExport', 'Export preset'],
	['deliveryReportNoConversions', 'This delivery converted nothing.'],
	['measureLoudness', 'Measure loudness'],
	['measuringLoudness', 'Measuring loudness'],
	['loudnessMeasured', 'Loudness measured'],
]);

export const REPORT_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({ ...REPORT_ITEM_COPY, ...Object.fromEntries(REPORT_COPY_ENTRIES.map(([key, en]) => [key, en])) }),
});
