/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport } from './delivery-report.ts';
import { buildSesxProject, type SesxImportOptions, type SesxImportPlan } from './sesx-import-project.ts';
import type { SesImportResult } from './ses-import.ts';

/** Reuse Audition audio staging while retaining the legacy source and its losses. */
export function buildSesProject(session: SesImportResult, options: SesxImportOptions): SesxImportPlan {
	const plan = buildSesxProject(session.document, {
		...options,
		fileName: options.fileName ? `${options.fileName.replace(/\.ses$/iu, '')}.sesx` : undefined,
	});
	const draft = createDeliveryReport({
		...plan.report.subject, format: 'ses', container: 'Cool Edit / Adobe Audition SES',
	});
	for (const item of plan.report.items) {
		addDeliveryReportItem(draft, {
			...item,
			code: item.code.replace(/^sesx\./u, 'ses.'),
			...(item.message ? { message: item.message.replaceAll('SESX', 'SES') } : {}),
		});
	}
	for (const warning of session.warnings) {
		addDeliveryReportItem(draft, {
			...warning, disposition: warning.disposition ?? 'omitted', severity: 'warning', scope: { kind: 'session' },
		});
	}
	return Object.freeze({
		...plan,
		report: Object.freeze({ ...sealDeliveryReport(draft), direction: 'import' as const }),
	});
}
