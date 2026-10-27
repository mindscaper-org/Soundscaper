/* SPDX-License-Identifier: AGPL-3.0-only */

import { PARAMETRIC_EQ_PRESENTATION_COPY } from '../../i18n/editor-parametric-eq-copy.ts';
import { formatLocalizedTemplate } from './localization-template.ts';

export function parametricEqFrequencyLimit(copy: Readonly<Record<string, string>>, authoredFrequency: number,
	effectiveFrequency: number, sampleRate: number): string {
	return formatLocalizedTemplate(copy['ui.parametricEq.frequencyLimit'] || PARAMETRIC_EQ_PRESENTATION_COPY.frequencyLimit,
		{ authoredFrequency, effectiveFrequency, sampleRate });
}
