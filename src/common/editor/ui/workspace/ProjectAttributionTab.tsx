/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';
import AttributionTab from '../AttributionTab.tsx';
import { FREESOUND_ATTRIBUTION_ENGLISH_COPY } from '../../../i18n/freesound-attribution-copy.js';
import { useTranslationScope } from '../use-translation-scope.ts';
import type {
	AttributionCsvFileService,
} from '../attribution-presentation-contract.ts';
import { createProjectAttributionReport } from '../../project-attribution-report.ts';
import {
	presentProjectAttributionReport,
	saveProjectAttributionCsv,
} from './project-attribution-presentation.ts';

export interface ProjectAttributionTabProps {
	readonly project: Readonly<Record<string, unknown>> | null | undefined;
	readonly copy: Readonly<Record<string, string>>;
	readonly locale?: string;
	readonly fileService?: AttributionCsvFileService | null;
	readonly run?: (operation: () => unknown) => unknown;
}

/** Lazy project adapter which keeps report generation and CSV serialization off the startup graph. */
export function ProjectAttributionTab({
	project,
	copy,
	locale,
	fileService,
	run,
}: ProjectAttributionTabProps) {
	const localizedCopy = { ...copy, ...useTranslationScope('freesoundAttribution', FREESOUND_ATTRIBUTION_ENGLISH_COPY, locale, copy) };
	const { domainReport, report, reportFailed } = useMemo(() => {
		try {
			const domainReport = project ? createProjectAttributionReport(project) : null;
			return { domainReport, report: domainReport ? presentProjectAttributionReport(domainReport) : null, reportFailed: false };
		} catch { return { domainReport: null, report: null, reportFailed: true }; }
	}, [project]);
	const exportCsv = domainReport && fileService ? () => {
		const operation = () => saveProjectAttributionCsv(domainReport, project?.title, fileService);
		if (run) void run(operation);
		else void operation();
	} : undefined;

	return <AttributionTab
		copy={localizedCopy}
		report={report}
		onExportCsv={exportCsv}
		errorMessage={reportFailed ? localizedCopy.reportError : undefined}
	/>;
}

export default ProjectAttributionTab;
