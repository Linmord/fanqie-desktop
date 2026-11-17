import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useReader, type Segment } from '@/stores/reader';
import { useBookshelf } from '@/stores/bookshelf';
import { useAccount } from '@/stores/account';
import { ConfigProvider, Popover, Slider } from 'antd';
import { CommentOutlined, FullscreenExitOutlined, FullscreenOutlined, UnorderedListOutlined } from '@ant-design/icons';
import type { Chapter } from '@/types';
import * as api from '@/services/api';
import CommentDrawer from '@/components/CommentDrawer';
import SettingsPanel from '@/components/Reader/SettingsPanel';
import TocDrawer from '@/components/Reader/TocDrawer';
import { FONTS } from '@/components/Reader/options';
import { splitParagraphs } from '@/components/Reader/text';
import { useTheme, antdConfig } from '@/stores/theme';

// macOS 隐藏式标题栏的红绿灯压在阅读页左上角，工具栏要让开
const isMac = navigator.userAgent.includes('Mac');

type CommentPara = { chapterId: string; index: number; text: string; count: number };

/** 反爬字体按章生效：把字体名换成带章节 id 的名字，避免相邻两章的同名字体互相覆盖 */
function scopeFont(css: string, chapterId: string) {
  const name = css.match(/font-family:\s*([^;,}]+)/)?.[1]?.trim();
  if (!name) return null;
  const family = `fq-font-${chapterId}`;
  return { css: css.split(name).join(`"${family}"`), family };
}

/** 章节流里的一章。单独 memo，滚动时更新进度不会重渲染所有段落 */
const SegmentView = memo(function SegmentView({ seg, fontStack, loggedIn, onComment, onRetry, onLogin }: {
  seg: Segment;
  fontStack: string;
  loggedIn: boolean;
  onComment: (p: CommentPara) => void;
  onRetry: (chapterId: string) => void;
  onLogin: () => void;
}) {
  const { chapter, status, content, fontCss, paraIdx, commentStats } = seg;
  const font = fontCss ? scopeFont(fontCss, chapter.id) : null;
  return (
    <section
      className="reader-seg"
      data-seg={chapter.id}
      style={font ? { fontFamily: `"${font.family}", ${fontStack}` } : undefined}
    >
      <h2 className="reader-chapter-title reader-anchor" data-ch={chapter.id} data-para={0}>
        {chapter.title}
      </h2>
      {/* 放在标题后面，标题才是 first-child，不多出上边距 */}
      {font && <style dangerouslySetInnerHTML={{ __html: font.css }} />}
      {status === 'loading' && <div className="reader-seg-status">加载中…</div>}
      {status === 'error' && (
        <div className="reader-seg-status error">
          <p>{seg.error || '本章加载失败'}</p>
          <div className="reader-seg-actions">
            <button onClick={() => onRetry(chapter.id)}>重试</button>
            {!loggedIn && <button onClick={onLogin}>登录</button>}
          </div>
        </div>
      )}
      {/* data-para 用原始行号：清洗掉空行后，段评段号和记住的位置仍能对上 */}
      {status === 'ready' && splitParagraphs(content).map(({ text, line: i }) => {
        const idx = paraIdx[i] ?? -1;
        const count = commentStats[idx] || 0;
        return (
          <p key={i} className="reader-para reader-anchor" data-ch={chapter.id} data-para={i}>
            {idx >= 0 ? (
              <>
                {text.slice(0, -1)}
                {/* 气泡和最后一个字绑在一起，避免单独掉到下一行；没有段评的段落悬停才显示 */}
                <span className="para-tail">
                  {text.slice(-1)}
                  <button
                    className={`para-comment${count ? '' : ' empty'}`}
                    title={count ? '查看段评' : '写段评'}
                    onClick={() => onComment({ chapterId: chapter.id, index: idx, text, count })}
                  >
                    {count ? (count > 999 ? '999+' : count) : <CommentOutlined />}
                  </button>
                </span>
              </>
            ) : text}
          </p>
        );
      })}
    </section>
  );
});

export default function Reader() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>();
  const nav = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const appDark = useTheme((s) => s.dark);
  const [commentPara, setCommentPara] = useState<CommentPara | null>(null);
  // 段评抽屉关闭动画期间还要用到章节 id，单独留一份
  const [commentCh, setCommentCh] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  // 沉浸模式：往下读时收起工具栏，往上滚或鼠标移到上下边缘时出现
  const [chromeVisible, setChromeVisible] = useState(true);
  const [fullScreen, setFullScreen] = useState(false);
  const [progress, setProgress] = useState(0);
  // 拖动进度条时预览的章节序号
  const [preview, setPreview] = useState<number | null>(null);
  const lastTopRef = useRef(0);

  const {
    chapters, segments, currentId, settings,
    loadChapters, openAt, retry, setCurrent, addCommentCount, loadSettings,
  } = useReader();
  const loggedIn = useAccount((s) => !!s.user);
  const openLogin = useAccount((s) => s.openLogin);
  const bookTitle = useBookshelf((s) => s.items.find((i) => i.book.id === bookId)?.book.title) || '';

  const updateProgress = useBookshelf((s) => s.updateProgress);
  const savePosition = useBookshelf((s) => s.savePosition);

  // 打开阅读页时记下书架上的章内位置。必须在挂载时取：之后换章会把它清零
  const restoreRef = useRef<{ chapterId: string; para: number } | null | undefined>(undefined);
  if (restoreRef.current === undefined) {
    const item = useBookshelf.getState().items.find((i) => i.book.id === bookId);
    restoreRef.current = item?.lastReadParaIndex ? { chapterId: item.lastReadChapterId, para: item.lastReadParaIndex } : null;
  }
  // 章节流重置后要滚到的位置：等目标章正文到了再滚
  const pendingRef = useRef<{ chapterId: string; para: number } | null>(null);
  // 视口顶部的那一段及其屏幕位置。章节流在上方增删内容、或改字号后，靠它把位置拉回来
  const anchorRef = useRef<{ el: HTMLElement; top: number } | null>(null);
  // 视口顶部是哪章第几段；滚动停下后再写盘
  const posRef = useRef<{ ch: string; para: number } | null>(null);
  const saveTimer = useRef<number>();
  const savePosRef = useRef(() => {});
  savePosRef.current = () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const pos = posRef.current;
    if (bookId && pos) savePosition(bookId, pos.ch, pos.para);
  };

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    api.isFullScreen().then(setFullScreen);
    return api.onFullScreenChange(setFullScreen);
  }, []);

  /** 清空章节流，从指定章（的指定段）重新开始 */
  const jump = useCallback((chapter: Chapter, para = 0) => {
    if (saveTimer.current) savePosRef.current();
    pendingRef.current = { chapterId: chapter.id, para };
    anchorRef.current = null;
    openAt(chapter);
  }, [openAt]);

  // 从摸鱼窗口回来：从那边读到的章节和段落重新打开章节流
  useEffect(() => api.onMoyuExit(({ chapterId: ch, para }) => {
    const target = useReader.getState().chapters.find((c) => c.id === ch);
    if (target) jump(target, para);
  }), [jump]);

  useEffect(() => {
    if (!bookId) return;
    loadChapters(bookId).then(() => {
      const ch = useReader.getState().chapters;
      const target = ch.find((c) => c.id === chapterId) || ch[0];
      if (!target) return;
      // 不在这里清空 restoreRef：StrictMode 下这个 effect 会跑两次，清掉后第二次就丢了位置
      const r = restoreRef.current;
      jump(target, r && r.chapterId === target.id ? r.para : 0);
    });
  }, [bookId, chapterId, loadChapters, jump]);

  // 当前章变了就更新书架进度（会同步云端）
  useEffect(() => {
    if (!bookId || !currentId) return;
    const list = useReader.getState().chapters;
    const i = list.findIndex((c) => c.id === currentId);
    if (i >= 0) updateProgress(bookId, list[i].id, list[i].title, i, list.length);
  }, [currentId, bookId, updateProgress]);

  // 登录后自动重试加载失败的章节
  useEffect(() => {
    if (!loggedIn) return;
    useReader.getState().segments.filter((g) => g.status === 'error').forEach((g) => retry(g.chapter.id));
  }, [loggedIn, retry]);

  // 离开阅读页时把还没写盘的位置存下来，并清空章节流
  useEffect(() => () => {
    if (saveTimer.current) savePosRef.current();
    useReader.getState().reset();
  }, []);

  /** 找视口顶部的那一段（二分，段落按文档顺序排列） */
  const topAnchor = () => {
    const body = bodyRef.current;
    if (!body) return null;
    const list = body.querySelectorAll<HTMLElement>('.reader-anchor');
    if (!list.length) return null;
    const top = body.getBoundingClientRect().top + 1;
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].getBoundingClientRect().bottom <= top) lo = mid + 1;
      else hi = mid;
    }
    return list[lo];
  };

  /** 记下锚点、当前章、章内进度 */
  const track = () => {
    const body = bodyRef.current;
    const a = topAnchor();
    if (!body || !a) return;
    anchorRef.current = { el: a, top: a.getBoundingClientRect().top };
    const ch = a.dataset.ch!;
    posRef.current = { ch, para: Number(a.dataset.para) || 0 };
    setCurrent(ch);
    const seg = body.querySelector<HTMLElement>(`[data-seg="${CSS.escape(ch)}"]`);
    if (seg) {
      const passed = body.getBoundingClientRect().top - seg.getBoundingClientRect().top;
      const span = seg.offsetHeight - body.clientHeight;
      setProgress(span > 0 ? Math.min(1, Math.max(0, passed / span)) : 1);
    }
  };

  /** 离两头不到 1.5 屏时接上前后章 */
  const grow = () => {
    const body = bodyRef.current;
    if (!body) return;
    const s = useReader.getState();
    const screen = body.clientHeight * 1.5;
    if (body.scrollHeight - body.scrollTop - body.clientHeight < screen) s.appendNext();
    if (body.scrollTop < screen) s.prependPrev();
  };

  // 章节流或排版变化后：先把阅读位置拉回原处，再看要不要接新章节
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const pending = pendingRef.current;
    if (pending) {
      const first = useReader.getState().segments[0];
      if (!first || first.chapter.id !== pending.chapterId) return;
      if (first.status === 'loading') {
        body.scrollTop = 0;
        lastTopRef.current = 0;
        return;
      }
      pendingRef.current = null;
      // 记下的那一行可能已被清洗掉（空行），取它之后的第一段
      const el = pending.para > 0
        ? [...body.querySelectorAll<HTMLElement>(`[data-seg="${CSS.escape(first.chapter.id)}"] .reader-para`)]
          .find((p) => Number(p.dataset.para) >= pending.para) || null
        : null;
      body.scrollTop = el ? body.scrollTop + el.getBoundingClientRect().top - body.getBoundingClientRect().top : 0;
      if (!el) setChromeVisible(true);
    } else {
      const a = anchorRef.current;
      if (a?.el.isConnected) {
        const d = a.el.getBoundingClientRect().top - a.top;
        if (Math.abs(d) > 0.5) body.scrollTop += d;
      }
    }
    lastTopRef.current = body.scrollTop;
    track();
    grow();
  }, [segments, settings.fontSize, settings.lineHeight, settings.pageWidth, settings.fontFamily]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const body = bodyRef.current;
    if (!body || pendingRef.current) return;
    const st = body.scrollTop;
    const delta = st - lastTopRef.current;
    lastTopRef.current = st;
    // 章首、往回滚、滚到流的尽头时显示
    if (st < 24 || delta < -4 || st >= body.scrollHeight - body.clientHeight - 2) setChromeVisible(true);
    else if (delta > 4) setChromeVisible(false);
    track();
    grow();

    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => savePosRef.current(), 600);
  };

  /** 跳到前后章的章首：已经在流里就直接滚过去，否则重置章节流 */
  const goChapter = (delta: number) => {
    const body = bodyRef.current;
    const { chapters: list, currentId: cur, segments: segs } = useReader.getState();
    const target = list[list.findIndex((c) => c.id === cur) + delta];
    if (!body || !target) return;
    const el = segs.some((g) => g.chapter.id === target.id && g.status === 'ready')
      ? body.querySelector<HTMLElement>(`[data-seg="${CSS.escape(target.id)}"]`)
      : null;
    if (el) body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top;
    else jump(target);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 段评、目录抽屉打开时，按键留给抽屉；带修饰键的组合留给系统
      if (commentPara || tocOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false);
        else if (fullScreen) api.toggleFullScreen();
        else nav(-1);
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        api.toggleFullScreen();
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        setSettingsOpen(false);
        setTocOpen(true);
        return;
      }
      const body = bodyRef.current;
      if (!body) return;
      // 翻一屏时留出约两行重叠，方便接上文
      const overlap = settings.fontSize * settings.lineHeight * 2;
      const scroll = (top: number) => {
        e.preventDefault();
        body.scrollBy({ top, behavior: 'smooth' });
      };
      switch (e.key) {
        case 'ArrowDown': return scroll(60);
        case 'ArrowUp': return scroll(-60);
        case 'ArrowRight': e.preventDefault(); return goChapter(1);
        case 'ArrowLeft': e.preventDefault(); return goChapter(-1);
        case 'PageUp': return scroll(-(body.clientHeight - overlap));
        case 'PageDown':
        case ' ':
          return scroll((e.key === ' ' && e.shiftKey ? -1 : 1) * (body.clientHeight - overlap));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }); // 每次渲染重新绑定，拿到最新的状态

  const onComment = useCallback((p: CommentPara) => {
    setCommentCh(p.chapterId);
    setCommentPara(p);
  }, []);

  const fontStack = FONTS.find((f) => f.value === settings.fontFamily)?.css || FONTS[0].css;
  // 阅读主题只作用于阅读页；antd 浮层（Aa 面板、抽屉）挂在容器内，才能拿到同一套颜色变量
  const readerDark = settings.theme === 'night' || (settings.theme === 'auto' && appDark);
  const showChrome = chromeVisible || settingsOpen || tocOpen || preview !== null;
  const curIdx = chapters.findIndex((c) => c.id === currentId);
  const curChapter = chapters[curIdx];
  const curReady = segments.some((g) => g.chapter.id === currentId && g.status === 'ready');

  return (
    <ConfigProvider theme={antdConfig(readerDark)} getPopupContainer={() => containerRef.current || document.body}>
      <div
        className="reader-container"
        ref={containerRef}
        data-reader-theme={settings.theme === 'auto' ? undefined : settings.theme}
        onMouseMove={(e) => {
          if (e.clientY < 72 || e.clientY > window.innerHeight - 72) setChromeVisible(true);
        }}
      >
        <div
          className={`reader-header${showChrome ? '' : ' hidden'}`}
          style={isMac && !fullScreen ? { paddingLeft: 88 } : undefined}
        >
          <button className="reader-tool" onClick={() => nav(-1)}>← 返回</button>
          <button className="reader-tool" title="目录（T）" onClick={() => setTocOpen(true)}>
            <UnorderedListOutlined />
          </button>
          <span className="reader-title">{curChapter?.title || ''}</span>
          <div className="reader-tools">
            <button
              className="reader-tool"
              title="摸鱼：透明小窗只显示正文，⌥+Q 一键隐藏"
              onClick={() => {
                const pos = posRef.current;
                if (!bookId || !pos) return;
                // 先把章内位置写盘，摸鱼窗口从同一段接着读
                savePosRef.current();
                api.openMoyu(bookId, pos.ch, pos.para);
              }}
            >
              摸鱼
            </button>
            <button
              className="reader-tool"
              title={fullScreen ? '退出全屏（F）' : '全屏（F）'}
              onClick={() => api.toggleFullScreen()}
            >
              {fullScreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            </button>
            <Popover
              content={<SettingsPanel />}
              trigger="click"
              placement="bottomRight"
              arrow={false}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
            >
              <button className="reader-tool reader-aa" title="阅读设置">Aa</button>
            </Popover>
          </div>
        </div>

        <div className="reader-body" ref={bodyRef} onScroll={onScroll}>
          {segments.length === 0 ? (
            <div className="loading">加载中...</div>
          ) : (
            <div
              className="reader-text"
              style={{
                fontSize: settings.fontSize,
                lineHeight: settings.lineHeight,
                fontFamily: fontStack,
                ['--reader-width' as string]: `${settings.pageWidth}px`,
              }}
            >
              {segments.map((seg) => (
                <SegmentView
                  key={seg.chapter.id}
                  seg={seg}
                  fontStack={fontStack}
                  loggedIn={loggedIn}
                  onComment={onComment}
                  onRetry={retry}
                  onLogin={openLogin}
                />
              ))}
            </div>
          )}
        </div>

        {curIdx >= 0 && curReady && (
          <div className="reader-progress">
            第 {curIdx + 1}/{chapters.length} 章 · 本章 {Math.round(progress * 100)}%
          </div>
        )}

        <div className={`reader-nav${showChrome ? '' : ' hidden'}`}>
          <button onClick={() => setTocOpen(true)}>目录</button>
          <button onClick={() => goChapter(-1)} disabled={curIdx <= 0}>上一章</button>
          <Slider
            className="reader-slider"
            min={0}
            max={Math.max(0, chapters.length - 1)}
            value={preview ?? Math.max(0, curIdx)}
            disabled={chapters.length < 2}
            tooltip={{ formatter: (v) => (v === undefined ? '' : chapters[v]?.title || '') }}
            onChange={setPreview}
            onChangeComplete={(v) => {
              setPreview(null);
              if (chapters[v] && v !== curIdx) jump(chapters[v]);
            }}
          />
          <button onClick={() => goChapter(1)} disabled={curIdx < 0 || curIdx >= chapters.length - 1}>下一章</button>
        </div>

        <TocDrawer
          open={tocOpen}
          onClose={() => setTocOpen(false)}
          bookTitle={bookTitle}
          chapters={chapters}
          currentId={currentId}
          onSelect={(c) => c.id !== currentId && jump(c)}
          topInset={isMac && !fullScreen}
        />

        {bookId && (commentCh || currentId) && (
          <CommentDrawer
            bookId={bookId}
            itemId={commentCh || currentId}
            para={commentPara}
            onClose={() => setCommentPara(null)}
            onPosted={(idx) => {
              addCommentCount(commentCh, idx);
              setCommentPara((p) => p && { ...p, count: p.count + 1 });
            }}
          />
        )}
      </div>
    </ConfigProvider>
  );
}
