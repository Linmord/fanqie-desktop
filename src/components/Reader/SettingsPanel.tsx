import { MinusOutlined, PlusOutlined } from '@ant-design/icons';
import { useReader } from '@/stores/reader';
import { FONT_SIZE, FONTS, LINE_HEIGHTS, PAGE_WIDTHS, THEMES } from './options';

function Seg<T extends string | number>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="rs-seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 「Aa」浮层：字号、行高、宽度、字体、主题，改动立即生效 */
export default function SettingsPanel() {
  const { settings, updateSettings } = useReader();
  const { fontSize } = settings;

  return (
    <div className="reader-settings">
      <div className="rs-row">
        <span className="rs-label">字号</span>
        <div className="rs-stepper">
          <button disabled={fontSize <= FONT_SIZE.min} onClick={() => updateSettings({ fontSize: fontSize - 1 })}>
            <MinusOutlined />
          </button>
          <span className="rs-value">{fontSize}</span>
          <button disabled={fontSize >= FONT_SIZE.max} onClick={() => updateSettings({ fontSize: fontSize + 1 })}>
            <PlusOutlined />
          </button>
        </div>
      </div>
      <div className="rs-row">
        <span className="rs-label">行距</span>
        <Seg options={LINE_HEIGHTS} value={settings.lineHeight} onChange={(lineHeight) => updateSettings({ lineHeight })} />
      </div>
      <div className="rs-row">
        <span className="rs-label">宽度</span>
        <Seg options={PAGE_WIDTHS} value={settings.pageWidth} onChange={(pageWidth) => updateSettings({ pageWidth })} />
      </div>
      <div className="rs-row">
        <span className="rs-label">字体</span>
        <Seg options={FONTS} value={settings.fontFamily} onChange={(fontFamily) => updateSettings({ fontFamily })} />
      </div>
      <div className="rs-row">
        <span className="rs-label">主题</span>
        <div className="rs-themes">
          {THEMES.map((t) => (
            <button
              key={t.value}
              className={`rs-theme${t.value === settings.theme ? ' active' : ''}`}
              onClick={() => updateSettings({ theme: t.value })}
            >
              <span className="rs-swatch" style={{ background: t.swatch }} />
              <span className="rs-theme-name">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
