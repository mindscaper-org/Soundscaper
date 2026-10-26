/* SPDX-License-Identifier: AGPL-3.0-only */

const ENTRIES = Object.freeze([
	['workspaceOnboardingTitle', 'Getting started'],
	['workspaceOnboardingQuestion', 'What UI layout (workspace) do you want?'],
	['workspaceOnboardingAudacityDescription', 'Closely matches the layout of Audacity 4'],
	['workspaceOnboardingSoundscaperDescription', "Soundscaper's own layout with vertical rulers, side meters and effects on the left"],
	['workspaceOnboardingHint', 'You can change between these layouts at any time from View > Workspace'],
	['workspaceOnboardingSelect', 'Select workspace layout'],
	['workspaceOnboardingMenu', 'Set up workspace'],
]);

export const WORKSPACE_ONBOARDING_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
});
