import { create } from 'zustand';
import { theme as antdTheme, type ThemeConfig } from 'antd';
import type { Appearance } from '@/types';
import * as api from '@/services/api';

// 桌面端由主进程的 nativeTheme 决定 prefers-color-scheme；浏览器里预览时按 appearance 自己算
const media = window.matchMedia('(prefers-color-scheme: dark)');
const resolveDark = (appearance: Appearance) =>
  appearance === 'system' ? media.matches : appearance === 'dark';

const apply = (dark: boolean) => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
};

interface ThemeState {
  appearance: Appearance;
  /** 当前实际生效的是否为深色 */
  dark: boolean;
  init: () => Promise<void>;
  cycle: () => Promise<void>;
}

const order: Appearance[] = ['system', 'light', 'dark'];

export const useTheme = create<ThemeState>((set, get) => ({
  appearance: 'system',
  dark: media.matches,

  init: async () => {
    const appearance = await api.getAppearance();
    set({ appearance, dark: resolveDark(appearance) });
  },

  cycle: async () => {
    const next = order[(order.indexOf(get().appearance) + 1) % order.length];
    const appearance = await api.setAppearance(next);
    set({ appearance, dark: resolveDark(appearance) });
  },
}));

apply(media.matches);
useTheme.subscribe((s) => apply(s.dark));
media.addEventListener('change', () => {
  useTheme.setState({ dark: resolveDark(useTheme.getState().appearance) });
});

export const appearanceLabel: Record<Appearance, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

/** antd 主题，与 index.css 里的颜色变量保持一致 */
export function antdConfig(dark: boolean): ThemeConfig {
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: dark
      ? { colorPrimary: '#D97757', colorBgBase: '#262624', colorTextBase: '#E8E6DC', colorBgElevated: '#30302E', borderRadius: 8 }
      : { colorPrimary: '#C96442', colorBgBase: '#FAF9F5', colorTextBase: '#3D3929', colorBgElevated: '#FFFFFF', borderRadius: 8 },
  };
}
