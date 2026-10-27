import { useComponentCopy } from '../contexts/ComponentCopyContext';
import React from 'react';
import { GhostButton } from '../GhostButton';
import { useTheme } from '../ThemeProvider';
import './EffectsPanelHeader.css';

export interface EffectsPanelHeaderProps {
  /**
   * Header title text
   */
  title?: string;

  /**
   * Called when close button is clicked
   */
  onClose?: () => void;

  /**
   * Additional CSS class names
   */
  className?: string;
}

/**
 * EffectsPanelHeader - Header component for the Effects panel
 * Displays the panel title and close button
 */
export const EffectsPanelHeader: React.FC<EffectsPanelHeaderProps> = ({
  title,
  onClose,
  className = '',
}) => {
  const { theme } = useTheme(); const { copy } = useComponentCopy();

  const style = {
    '--eph-bg': theme.background.surface.default,
    '--eph-border': theme.border.default,
    '--eph-text-color': theme.foreground.text.primary,
  } as React.CSSProperties;

  return (
    <div
      className={`effects-panel-header ${className}`}
      style={style}
    >
      <div className="effects-panel-header__content">
        <h2 className="effects-panel-header__title">{title ?? copy.effects}</h2>
      </div>

      <GhostButton
        icon="close"
        size="small"
        onClick={onClose}
        ariaLabel={copy.closeEffectsPanel}
        className="effects-panel-header__close-button"
      />
    </div>
  );
};

export default EffectsPanelHeader;
