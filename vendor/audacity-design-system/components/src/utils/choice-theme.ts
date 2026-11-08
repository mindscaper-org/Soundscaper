/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CSSProperties } from 'react';
import type { ThemeTokens } from '../../../tokens/src/tokens.v2';

type ChoiceThemeStyle = CSSProperties & Readonly<Record<`--${string}`, string>>;

/** Theme variables shared with each choice control's existing stylesheet. */
export function checkboxThemeStyle(theme: ThemeTokens): ChoiceThemeStyle {
	return {
		'--checkbox-bg-idle': theme.background.control.checkbox.idle,
		'--checkbox-bg-hover': theme.background.control.checkbox.hover,
		'--checkbox-bg-pressed': theme.background.control.checkbox.pressed,
		'--checkbox-icon-color': theme.foreground.icon.primary,
	};
}

export function radioThemeStyle(theme: ThemeTokens): ChoiceThemeStyle {
	return {
		'--radio-border': theme.border.control.radio,
		'--radio-border-hover': theme.border.focus,
		'--radio-bg': theme.background.control.radio.idle,
		'--radio-pip': theme.background.control.button.primary.idle,
		'--radio-pip-disabled': theme.foreground.icon.disabled,
	};
}
