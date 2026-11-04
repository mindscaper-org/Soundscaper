import { iconNameToChar } from './icon-codes.ts';
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
  mixer: iconNameToChar('MIXER'),
  menu: iconNameToChar('MENU_THREE_DOTS'),
  gripper: iconNameToChar('TOOLBAR_GRIP'),
  undo: iconNameToChar('UNDO'),
  redo: iconNameToChar('REDO'),
  play: iconNameToChar('PLAY_FILL'),
  pause: iconNameToChar('PAUSE_FILL'),
  stop: iconNameToChar('STOP_FILL'),
  record: iconNameToChar('RECORD_FILL'),
  rewind: iconNameToChar('REWIND_START_FILL'),
  forward: iconNameToChar('REWIND_END_FILL'),
  'skip-back': iconNameToChar('REWIND_START_FILL'),
  'skip-forward': iconNameToChar('REWIND_END_FILL'),
  loop: iconNameToChar('LOOP'),
  plus: iconNameToChar('PLUS'),
  'zoom-in': iconNameToChar('ZOOM_IN'),
  'zoom-out': iconNameToChar('ZOOM_OUT'),
  automation: iconNameToChar('AUTOMATION'),
  cloud: iconNameToChar('CLOUD_FILE'),
  'cloud-filled': iconNameToChar('CLOUD_FILL'),
  'cloud-sync': iconNameToChar('CLOUD_FILE'),
  export: iconNameToChar('SHARE_FILE'),
  // MuseScore's IconCode::IMPORT. Upstream's map stops at SHARE_FILE (the 'export'
  // entry above), leaving hosts to fake an import affordance by rotating it.
  import: iconNameToChar('IMPORT'),
  copy: iconNameToChar('COPY'),
  paste: iconNameToChar('PASTE'),
  cut: iconNameToChar('CUT'),
  split: iconNameToChar('SPLIT_TOOL'),
  spectrogram: iconNameToChar('SPECTROGRAM'),
  workspace: iconNameToChar('WORKSPACE'),
  cog: iconNameToChar('SETTINGS_COG'),
  trash: iconNameToChar('DELETE_TANK'),
  silence: iconNameToChar('SILENCE_AUDIO_SELECTION'),
  trim: iconNameToChar('TRIM_AUDIO_OUTSIDE_SELECTION'),
  waveform: iconNameToChar('WAVEFORM'),
  playhead: iconNameToChar('PLAYHEAD'),
  'caret-down': iconNameToChar('SMALL_ARROW_DOWN'),
  close: iconNameToChar('CLOSE_X_ROUNDED'),
  user: iconNameToChar('ACCOUNT'),
  book: iconNameToChar('LYRICS'),
  brush: iconNameToChar('BRUSH'),
  volume: iconNameToChar('AUDIO'),
  metronome: iconNameToChar('METRONOME'),
  plug: iconNameToChar('PLUGIN'),
  plugins: iconNameToChar('PLUGIN'),
  microphone: iconNameToChar('MICROPHONE'),
  keyboard: iconNameToChar('SHORTCUTS'),
  label: iconNameToChar('LOOP_IN'),
  midi: iconNameToChar('MIDI_INPUT'),
  'chevron-left': iconNameToChar('CHEVRON_LEFT'),
  'chevron-right': iconNameToChar('CHEVRON_RIGHT'),
  'zoom-toggle': iconNameToChar('ZOOM_TOGGLE'),
  'zoom-to-selection': iconNameToChar('FIT_SELECTION'),
  'zoom-to-fit': iconNameToChar('FIT_PROJECT'),
  'track-decrease-height': iconNameToChar('ARROW_UP'),
  'track-increase-height': iconNameToChar('ARROW_DOWN'),
  'track-fit-height': iconNameToChar('FIT_SELECTION'),
  power: iconNameToChar('BYPASS'),
  save: iconNameToChar('SAVE'),
  'grid-view': iconNameToChar('GRID_VIEW'),
  'list-view': iconNameToChar('LIST'),
  lock: iconNameToChar('LOCK_CLOSED'),
  eye: iconNameToChar('EYE_OPEN'),
  refresh: iconNameToChar('UPDATE'),
  check: iconNameToChar('TICK_RIGHT_ANGLE'),
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
