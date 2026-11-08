import { iconNameToChar } from '../Icon/icon-codes.ts';
/**
 * Checkbox Component
 *
 * A checkbox input with checked/unchecked states
 */

import React from 'react';
import { consumeChoiceActivation } from '../hooks/choice-activation';
import { checkboxThemeStyle } from '../utils/choice-theme';
import { useTheme } from '../ThemeProvider';
import './Checkbox.css';

export interface CheckboxProps {
  /**
   * Whether the checkbox is checked
   */
  checked?: boolean;
  /**
   * Whether the checkbox is disabled
   */
  disabled?: boolean;
  /**
   * Callback when checkbox state changes
   */
  onChange?: (checked: boolean) => void;
  /**
   * Tab index for keyboard navigation
   */
  tabIndex?: number;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Accessible label for screen readers
   */
  'aria-label'?: string;
  /**
   * ID of explanatory copy for screen readers
   */
  'aria-describedby'?: string;
}

/**
 * Checkbox - A checkbox input component
 */
export function Checkbox({
  checked = false,
  disabled = false,
  onChange,
  tabIndex,
  className = '',
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: CheckboxProps) {
  const { theme } = useTheme();
  const [isHovered, setIsHovered] = React.useState(false);
  const [isPressed, setIsPressed] = React.useState(false);

  const style = checkboxThemeStyle(theme);

  const handleClick = () => {
    if (!disabled && onChange) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (consumeChoiceActivation(e)) handleClick();
  };

  const getStateClass = () => {
    if (isPressed) return 'checkbox--pressed';
    if (isHovered) return 'checkbox--hover';
    return 'checkbox--default';
  };

  return (
    <div
      className={`checkbox ${checked ? 'checkbox--checked' : 'checkbox--unchecked'} ${getStateClass()} ${disabled ? 'checkbox--disabled' : ''} ${className}`}
      role="checkbox"
      aria-checked={checked}
      // A role="checkbox" element carries no native disabled state, so without
      // this the control is announced as an ordinary, operable checkbox.
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      tabIndex={tabIndex !== undefined ? tabIndex : (disabled ? -1 : 0)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => !disabled && setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      onMouseDown={() => !disabled && setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      style={style}
    >
      {checked && (
        <div className="checkbox__icon">{iconNameToChar('TICK_RIGHT_ANGLE')}</div>
      )}
    </div>
  );
}

export default Checkbox;
