import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { Chapter, MoyuPrefs } from '@/types';
import * as api from '@/services/api';
import { FONTS, normalizeSettings } from '@/components/Reader/options';
import { splitParagraphs } from '@/components/Reader/text';

interface Segment {
  chapter: Chapter;
  /** line 是原始行号，和阅读页的 data-para 一致，两边记的位置能对上 */
  paras: { text: string; line: number }[];
}

const DEFAULT_PREFS: MoyuPrefs = { bounds: null, opacity: 0, fontSize: 15, color: 'dark' };
const FONT_SIZE = { min: 12, max: 24 };
// 用户一动手就不再自动对齐
const USER_EVENTS = ['wheel', 'keydown', 'pointerdown'] as const;

/** 摸鱼窗口：透明背景上只浮着正文，滚到章末自动接下一章 */
export default function Moyu() {
  const { bookId = '', chapterId = '' } = useParams<{ bookId: string; chapterId: string }>();
  const [search] = useSearchParams();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = useState<MoyuPrefs>(DEFAULT_PREFS);
  const [font, setFont] = useState({ family: FONTS[0].css, lineHeight: 1.8 });
  const [segments, setSegments] = useState<Segment[]>([]);
  const [hover, setHover] = useState(false);
  const chaptersRef = useRef<Chapter[]>([]);
  const loadingNext = useRef(false);
  // 视口顶部读到哪一章哪一段，退出时交给主窗口
  const posRef = useRef({ chapterId, para: Number(search.get('para')) || 0 });
  // 待对齐的目标段落：undefined 还没开始，null 已结束
  const alignRef = useRef<HTMLElement | null>();

  // 只有这个窗口的页面背景透明，主窗口不受影响
  useEffect(() => {
    document.documentElement.classList.add('moyu-window');
    return () => document.documentElement.classList.remove('moyu-window');
  }, []);

  // 字号、字体和正文一起到位，定位段落时排版不会再变
  useEffect(() => {
    (async () => {
      const [p, s, list] = await Promise.all([api.getMoyuPrefs(), api.getSettings(), api.chapters(bookId)]);
      const st = normalizeSettings(s);
      setPrefs(p);
      setFont({ family: FONTS.find((f) => f.value === st.fontFamily)?.css || FONTS[0].css, lineHeight: st.lineHeight });
      chaptersRef.current = list;
      const chapter = list.find((c) => c.id === chapterId) || list[0];
      if (chapter) setSegments([await fetchSegment(chapter)]);
    })();
  }, [bookId, chapterId]);

  // 第一章渲染出来后，滚到主窗口读到的那一段。目标靠近章末时一章的高度不够滚过去，
  // 要等下一章接上，所以在用户动手之前，每接上一章就再对齐一次
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !segments.length) return;
    if (alignRef.current === undefined) {
      const { chapterId: ch, para } = posRef.current;
      // 记下的那一行可能已被清洗掉（空行），取它之后的第一段
      alignRef.current = [...body.querySelectorAll<HTMLElement>(`.moyu-para[data-ch="${CSS.escape(ch)}"]`)]
        .find((p) => Number(p.dataset.para) >= para) || null;
      const stop = () => {
        alignRef.current = null;
        for (const ev of USER_EVENTS) window.removeEventListener(ev, stop, true);
      };
      for (const ev of USER_EVENTS) window.addEventListener(ev, stop, true);
    }
    const el = alignRef.current;
    if (el) body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top;
  }, [segments]);

  // 流的末尾一章到了就预取下一章，滚到章末时直接接上
  useEffect(() => {
    const last = segments[segments.length - 1];
    if (!last) return;
    const list = chaptersRef.current;
    const next = list[list.findIndex((c) => c.id === last.chapter.id) + 1];
    if (next) fetchSegment(next).catch(() => {});
  }, [segments]);

  const updatePrefs = (patch: Partial<MoyuPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    api.saveMoyuPrefs(patch);
  };

  const appendNext = async () => {
    const last = segments[segments.length - 1];
    if (!last || loadingNext.current) return;
    const list = chaptersRef.current;
    const next = list[list.findIndex((c) => c.id === last.chapter.id) + 1];
    if (!next) return;
    loadingNext.current = true;
    try {
      const seg = await fetchSegment(next);
      setSegments((s) => [...s, seg]);
    } finally {
      loadingNext.current = false;
    }
  };

  const onScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const top = body.getBoundingClientRect().top;
    const paras = body.querySelectorAll<HTMLElement>('.moyu-para');
    for (const p of paras) {
      if (p.getBoundingClientRect().bottom > top + 1) {
        posRef.current = { chapterId: p.dataset.ch!, para: Number(p.dataset.para) };
        break;
      }
    }
    // 离章末不到一屏半就把下一章接上
    if (body.scrollHeight - body.scrollTop - body.clientHeight < body.clientHeight * 1.5) appendNext();
  };

  const exit = () => api.closeMoyu(posRef.current.chapterId, posRef.current.para);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const body = bodyRef.current;
      if (!body || e.metaKey || e.ctrlKey || e.altKey) return;
      // 翻一屏留一行重叠，方便接上文
      const page = body.clientHeight - prefs.fontSize * font.lineHeight;
      const scroll = (top: number) => {
        e.preventDefault();
        body.scrollBy({ top, behavior: 'smooth' });
      };
      switch (e.key) {
        case 'Escape': return void exit();
        case 'ArrowDown': return scroll(40);
        case 'ArrowUp': return scroll(-40);
        case 'PageUp': return scroll(-page);
        case 'PageDown': return scroll(page);
        case ' ': return scroll(e.shiftKey ? -page : page);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // 无边框窗口：按住正文拖窗口，按住右下角改大小
  const dragWindow = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    api.startMoyuDrag(mode).catch(() => {});
  };

  const light = prefs.color === 'light';

  return (
    <div
      className={`moyu${light ? ' light' : ''}`}
      style={{ background: light ? `rgba(20, 20, 19, ${prefs.opacity})` : `rgba(250, 249, 245, ${prefs.opacity})` }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className="moyu-body"
        ref={bodyRef}
        onScroll={onScroll}
        onPointerDown={dragWindow('move')}
        style={{ fontSize: prefs.fontSize, lineHeight: font.lineHeight, fontFamily: font.family }}
      >
        {segments.map(({ chapter, paras }) => (
          <section key={chapter.id}>
            <div className="moyu-title">{chapter.title}</div>
            {paras.map(({ text, line }) => (
              <p key={line} className="moyu-para" data-ch={chapter.id} data-para={line}>{text}</p>
            ))}
          </section>
        ))}
      </div>

      <div className={`moyu-bar${hover ? '' : ' hidden'}`}>
        <input
          type="range"
          min={0}
          max={0.6}
          step={0.05}
          value={prefs.opacity}
          title="底色"
          onChange={(e) => updatePrefs({ opacity: Number(e.target.value) })}
        />
        <button title="切换文字颜色" onClick={() => updatePrefs({ color: light ? 'dark' : 'light' })}>
          {light ? '浅字' : '深字'}
        </button>
        <button
          title="缩小字号"
          onClick={() => updatePrefs({ fontSize: Math.max(FONT_SIZE.min, prefs.fontSize - 1) })}
        >
          A-
        </button>
        <button
          title="放大字号"
          onClick={() => updatePrefs({ fontSize: Math.min(FONT_SIZE.max, prefs.fontSize + 1) })}
        >
          A+
        </button>
        <button title="退出摸鱼（Esc）" onClick={exit}>退出</button>
      </div>

      <div className={`moyu-resize${hover ? '' : ' hidden'}`} onPointerDown={dragWindow('resize')} />
    </div>
  );
}

// 已请求的章节，预取和真正接章共用同一个请求；失败的不留，下次重新请求
const segCache = new Map<string, Promise<Segment>>();

function fetchSegment(chapter: Chapter): Promise<Segment> {
  let p = segCache.get(chapter.id);
  if (!p) {
    p = api.chapterContent(chapter.id).then(({ content }) => ({ chapter, paras: splitParagraphs(content || '') }));
    p.catch(() => segCache.delete(chapter.id));
    segCache.set(chapter.id, p);
  }
  return p;
}
