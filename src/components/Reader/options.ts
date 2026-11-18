import type { ReaderFontId, ReaderSettings, ReaderThemeId, ReadingMode } from '@/types';

export const FONT_SIZE = { min: 14, max: 28 };

export const READING_MODES: { value: ReadingMode; label: string }[] = [
  { value: 'scroll', label: '滚动' },
  { value: 'page', label: '翻页' },
];

export const LINE_HEIGHTS = [
  { value: 1.6, label: '紧凑' },
  { value: 1.8, label: '标准' },
  { value: 2.1, label: '宽松' },
];

export const PARA_SPACINGS = [
  { value: 0.3, label: '紧凑' },
  { value: 0.6, label: '标准' },
  { value: 1, label: '宽松' },
];

export const INDENTS = [
  { value: 'on', label: '空两字' },
  { value: 'off', label: '顶格' },
];

export const PAGE_WIDTHS = [
  { value: 600, label: '窄' },
  { value: 720, label: '中' },
  { value: 900, label: '宽' },
];

export const FONTS: { value: ReaderFontId; label: string; css: string }[] = [
  { value: 'serif', label: '宋体', css: 'var(--font-serif)' },
  { value: 'sans', label: '黑体', css: 'var(--font-sans)' },
  { value: 'kai', label: '楷体', css: "Georgia, 'Kaiti SC', 'STKaiti', 'KaiTi', serif" },
];

/** swatch 只用于面板里的色块，正文颜色在 index.css 按 data-reader-theme 定义 */
export const THEMES: { value: ReaderThemeId; label: string; swatch: string }[] = [
  { value: 'auto', label: '跟随应用', swatch: 'linear-gradient(135deg, #FAF9F5 50%, #262624 50%)' },
  { value: 'ivory', label: '象牙', swatch: '#FAF9F5' },
  { value: 'paper', label: '纸张', swatch: '#F0EEE6' },
  { value: 'night', label: '夜间', swatch: '#262624' },
];

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  pageWidth: 720,
  theme: 'auto',
  fontFamily: 'serif',
  readingMode: 'scroll',
  paraSpacing: 0.6,
  indent: true,
};

const pick = <T,>(list: { value: T }[], v: unknown, fallback: T): T =>
  list.some((o) => o.value === v) ? (v as T) : fallback;

/** 兼容旧版设置：旧 theme 是颜色对象、fontFamily 是 CSS 字体名，统一回落到默认值 */
export function normalizeSettings(raw: Partial<Record<keyof ReaderSettings, unknown>> | null | undefined): ReaderSettings {
  const d = DEFAULT_SETTINGS;
  const size = Number(raw?.fontSize);
  return {
    fontSize: Number.isFinite(size) ? Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, Math.round(size))) : d.fontSize,
    lineHeight: pick(LINE_HEIGHTS, raw?.lineHeight, d.lineHeight),
    pageWidth: pick(PAGE_WIDTHS, raw?.pageWidth, d.pageWidth),
    theme: pick(THEMES, raw?.theme, d.theme),
    fontFamily: pick(FONTS, raw?.fontFamily, d.fontFamily),
    readingMode: pick(READING_MODES, raw?.readingMode, d.readingMode),
    paraSpacing: pick(PARA_SPACINGS, raw?.paraSpacing, d.paraSpacing),
    indent: typeof raw?.indent === 'boolean' ? raw.indent : d.indent,
  };
}
