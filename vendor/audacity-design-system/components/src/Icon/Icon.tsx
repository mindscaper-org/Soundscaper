import React from 'react';
import '../assets/fonts/musescore-icon.css';
import './Icon.css';

export type IconName =
  | 'mixer'
  | 'menu'
  | 'gripper'
  | 'undo'
  | 'redo'
  | 'play'
  | 'pause'
  | 'stop'
  | 'record'
  | 'rewind'
  | 'forward'
  | 'skip-back'
  | 'skip-forward'
  | 'loop'
  | 'plus'
  | 'zoom-in'
  | 'zoom-out'
  | 'automation'
  | 'cloud'
  | 'cloud-filled'
  | 'cloud-sync'
  | 'export'
  | 'import'
  | 'copy'
  | 'paste'
  | 'cut'
  | 'split'
  | 'spectrogram'
  | 'workspace'
  | 'cog'
  | 'trash'
  | 'silence'
  | 'trim'
  | 'waveform'
  | 'playhead'
  | 'caret-down'
  | 'close'
  | 'user'
  | 'book'
  | 'brush'
  | 'volume'
  | 'metronome'
  | 'plug'
  | 'plugins'
  | 'microphone'
  | 'keyboard'
  | 'label'
  | 'midi'
  | 'chevron-left'
  | 'chevron-right'
  | 'zoom-toggle'
  | 'zoom-to-selection'
  | 'zoom-to-fit'
  | 'track-decrease-height'
  | 'track-increase-height'
  | 'track-fit-height'
  | 'power'
  | 'save'
  | 'grid-view'
  | 'list-view'
  | 'lock'
  | 'eye'
  | 'refresh'
  | 'check';

// Unicode mappings for MusescoreIcon font
const ICON_MAP: Record<IconName, string> = {
  mixer: '\uF41B',
  menu: '\uEF13',
  gripper: '\uF3A2',
  undo: '\uEF19',
  redo: '\uEF1A',
  play: '\uF446',
  pause: '\uF44B',
  stop: '\uF447',
  record: '\uF44A',
  rewind: '\uE007',
  forward: '\uE008',
  'skip-back': '\uF448',
  'skip-forward': '\uF449',
  loop: '\uEF1F',
  plus: '\uEF2A',
  'zoom-in': '\uEF18',
  'zoom-out': '\uEF16',
  automation: '\uF45C',
  cloud: '\uEF25',
  'cloud-filled': '\uF454',
  'cloud-sync': '\uEF25',
  export: '\uEF24',
  // MuseScore's IconCode::IMPORT. Upstream's map stops at SHARE_FILE (the 'export'
  // entry above), leaving hosts to fake an import affordance by rotating it.
  import: '\uF357',
  copy: '\uF398',
  paste: '\uF399',
  cut: '\uF39A',
  split: '\uF494',
  spectrogram: '\uF442',
  workspace: '\uF46B',
  cog: '\uEF55',
  trash: '\uEF2C',
  silence: '\uF43A',
  trim: '\uF43B',
  waveform: '\uF43C',
  playhead: '\uF478',
  'caret-down': '\uEF12',
  close: '\uEF14',
  user: '\uEF99',
  book: '\uF441',
  brush: '\uF444',
  volume: '\uEF4E',
  metronome: '\uEF20',
  plug: '\uF440',
  plugins: '\uF440',
  microphone: '\uF41B',
  keyboard: '\uF35D',
  label: '\uF3C7',
  midi: '\uF35E',
  'chevron-left': '\uF39C',
  'chevron-right': '\uF39B',
  'zoom-toggle': '\uF437',
  'zoom-to-selection': '\uF438',
  'zoom-to-fit': '\uF439',
  'track-decrease-height': '\uEF37',
  'track-increase-height': '\uEF36',
  'track-fit-height': '\uF439',
  power: '\uF38F',
  save: '\uEF29',
  'grid-view': '\uF35B',
  'list-view': '\uF3AA',
  lock: '\uF375',
  eye: '\uEF23',
  refresh: '\uF358',
  check: '\uEF31',
};

/** Upstream fit-to-height bar glyph; relative steps keep the existing arrow glyphs. */
const chevron = (y: number, dir: 'up' | 'down') =>
  dir === 'down' ? `M5.5 ${y - 2}L8 ${y}L10.5 ${y - 2}` : `M5.5 ${y + 2}L8 ${y}L10.5 ${y + 2}`;
const svgProps = {
  viewBox: '0 0 16 16', width: '1em', height: '1em', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round',
} as const;
const bar = <rect x="2.5" y="6.5" width="11" height="3" rx="0.5" />;
const DRAWN_ICONS: Partial<Record<IconName, React.ReactNode>> = {
  'track-fit-height': (
    <svg {...svgProps}>
      <path d="M2.5 1.5H13.5" />
      {bar}
      <path d={chevron(3.5, 'up')} />
      <path d={chevron(12.5, 'down')} />
      <path d="M2.5 14.5H13.5" />
    </svg>
  ),
};

/** Whether an icon is drawn (an SVG) rather than a font glyph. */
export const isDrawnIcon = (name: IconName): boolean => name in DRAWN_ICONS;

export interface IconProps {
  /**
   * Icon name from MusescoreIcon font
   */
  name: IconName;
  /**
   * Icon size in pixels
   */
  size?: number;
  /**
   * Icon color
   */
  color?: string;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 16,
  color,
  className = '',
}) => {
  const iconChar = ICON_MAP[name] || '';
  const drawn = DRAWN_ICONS[name];

  return (
    <span
      className={`icon musescore-icon ${className}`}
      style={{
        fontSize: `${size}px`,
        ...(color && { color }),
      }}
      aria-hidden="true"
      data-drawn-icon={drawn ? name : undefined}
    >
      {drawn ?? iconChar}
    </span>
  );
};

export default Icon;
