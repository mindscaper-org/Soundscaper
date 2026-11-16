/* SPDX-License-Identifier: AGPL-3.0-only */
import type { EarDeliveryPlan } from '../../../ear-delivery.ts';
import { createBw64RenderProject } from './bw64-render-project.ts';

/** Capture the authored programme width before rendering it to a speaker layout. */
export function createSpatialExportRenderProject<Project extends object>(project: Project, plan: Readonly<{
	format: string; channelCount: number;
	adm?: Readonly<{ metadata: unknown }>;
	ear?: EarDeliveryPlan;
}>): Project {
	if (plan.ear) return createBw64RenderProject(project, {
		channelCount: plan.ear.sourceChannelCount, metadata: plan.ear.metadata,
	});
	return plan.format === 'bw64' && plan.adm ? createBw64RenderProject(project, {
		channelCount: plan.channelCount, metadata: plan.adm.metadata,
	}) : project;
}
