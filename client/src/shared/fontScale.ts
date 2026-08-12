export type FontScalePreset = 'small' | 'default' | 'medium' | 'large' | 'xlarge';

export interface FontScaleOption {
  value: FontScalePreset;
  label: string;
  factor: number;
}

export const FONT_SCALE_OPTIONS: FontScaleOption[] = [
  { value: 'small', label: '小', factor: 0.85 },
  { value: 'default', label: '默认', factor: 1 },
  { value: 'medium', label: '中', factor: 1.1 },
  { value: 'large', label: '大', factor: 1.2 },
  { value: 'xlarge', label: '超大', factor: 1.3 },
];

const FONT_SCALE_STORAGE_KEY = 'biaoshu-ui-font-scale';
const validPresets = new Set(FONT_SCALE_OPTIONS.map((option) => option.value));

export function getFontScaleFactor(preset: FontScalePreset): number {
  return FONT_SCALE_OPTIONS.find((option) => option.value === preset)?.factor ?? 1;
}

export function getStoredFontScalePreset(): FontScalePreset {
  const stored = localStorage.getItem(FONT_SCALE_STORAGE_KEY);
  return stored && validPresets.has(stored as FontScalePreset) ? stored as FontScalePreset : 'default';
}

export function applyFontScalePreset(preset: FontScalePreset): void {
  localStorage.setItem(FONT_SCALE_STORAGE_KEY, preset);
  void window.yibiao?.setZoomFactor(getFontScaleFactor(preset));
}
