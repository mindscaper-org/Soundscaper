/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportPlan } from '../src/common/editor/export.js';
import { createDeliveryReportForPlan } from '../src/common/editor/delivery-conversion-inventory.ts';
import { reportAup4OwnedFeatureOmissions } from '../src/common/editor/aup4-feature-omissions.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../src/common/editor/project-owned-feature-requirements.ts';
import { formatAup4CompatibilityItem, formatDeliveryReportItem } from '../src/common/editor/ui/dialogs/editor-dialog-model.js';

test('actual delivery conversions use localized message identities even when the report holds an English diagnostic', () => {
	const plan = createExportPlan({ id: 'project', title: 'Authored $&', sampleRate: 48_000, masterChannels: 2,
		selection: { startFrame: 0, endFrame: 0 }, loop: { enabled: false, startFrame: 0, endFrame: 0 }, sources: [], clips: [],
		tracks: [{ type: 'audio', id: 'track', name: 'Authored', clipIds: [], mute: false, solo: false, hidden: false, collapsed: false, height: 120, laneGroupId: null }] },
	{ format: 'mp3', range: { startFrame: 0, endFrame: 48_000 } });
	const report = createDeliveryReportForPlan(plan, { sampleRate: 48_000 });
	const item = report.items.find(item => item.code === 'delivery.lossy-encode'); assert.ok(item);
	assert.equal(formatDeliveryReportItem(item, { 'reportItem.delivery.lossy-encode': 'Verlustbehaftete Kodierung' }), 'Verlustbehaftete Kodierung');
	assert.equal(formatDeliveryReportItem({ ...item, message: 'Original codec diagnostic' }, { 'reportItem.delivery.lossy-encode': 'Verlustbehaftete Kodierung' }), 'Verlustbehaftete Kodierung');
});

test('actual Audacity omission reports localize their known family and retain the original diagnostic data', () => {
	const report = { items: [] as Readonly<Record<string, unknown>>[] };
	reportAup4OwnedFeatureOmissions({ featureRequirements: { requirements: [{ id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.trackFolders }] } }, report,
		(target, item) => { (target.items as Readonly<Record<string, unknown>>[]).push(item); });
	const item = report.items.find(item => item.code === 'TRACK_FOLDER_STRUCTURE_OMITTED'); assert.ok(item);
	assert.equal(formatAup4CompatibilityItem(item, { 'reportItem.TRACK_FOLDER_STRUCTURE_OMITTED': 'Ordnerstruktur ausgelassen' }), 'Ordnerstruktur ausgelassen');
	assert.equal(typeof item.message, 'string', 'stored report diagnostics remain available');
});

test('unknown future report codes use localized fallback copy instead of humanizing a technical code or exposing English diagnostics', () => {
	const copy = { reportItemUnknown: 'Weitere Diagnose verfügbar' };
	assert.equal(formatDeliveryReportItem({ code: 'delivery.future-code', message: 'English details' }, copy), copy.reportItemUnknown);
	assert.equal(formatAup4CompatibilityItem({ code: 'FUTURE_ITEM', message: 'English details' }, copy), copy.reportItemUnknown);
});
