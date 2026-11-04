import { iconNameToChar } from '../Icon/icon-codes.ts';
import { DialogSideNavItem } from '../DialogSideNav/DialogSideNav';
import type { PreferencesPage } from './types';

export const menuItems: DialogSideNavItem<PreferencesPage>[] = [
  { id: 'general', label: 'General', icon: iconNameToChar('SETTINGS_COG') }, // cog
  { id: 'accounts', label: 'Accounts', icon: iconNameToChar('ACCOUNT') }, // user
  { id: 'appearance', label: 'Appearance', icon: iconNameToChar('BRUSH') }, // brush
  { id: 'audio-settings', label: 'Audio settings', icon: iconNameToChar('AUDIO') }, // volume
  { id: 'playback-recording', label: 'Playback/Recording', icon: iconNameToChar('MICROPHONE') }, // microphone
  { id: 'editing', label: 'Audio editing', icon: iconNameToChar('WAVEFORM') }, // waveform
  { id: 'spectral-display', label: 'Spectral display', icon: iconNameToChar('SPECTROGRAM') }, // spectrogram
  { id: 'plugins', label: 'Plugins', icon: iconNameToChar('PLUGIN') }, // plug
  { id: 'music', label: 'Music', icon: iconNameToChar('LYRICS') }, // book
  { id: 'cloud', label: 'Cloud', icon: iconNameToChar('CLOUD') }, // cloud
  { id: 'shortcuts', label: 'Shortcuts', icon: iconNameToChar('LYRICS') }, // keyboard
  { id: 'advanced-options', label: 'Advanced options', icon: iconNameToChar('SETTINGS_COG') }, // cog
];
