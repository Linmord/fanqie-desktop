import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useReader } from '@/stores/reader';
import { useBookshelf } from '@/stores/bookshelf';
import { ConfigProvider, Popover } from 'antd';
import { CommentOutlined, FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';
import * as api from '@/services/api';
import CommentDrawer from '@/components/CommentDrawer';
import SettingsPanel from '@/components/Reader/SettingsPanel';
import { FONTS } from '@/components/Reader/options';
import { splitParagraphs } from '@/components/Reader/text';
import { useTheme, antdConfig } from '@/stores/theme';

// macOS 隐藏式标题栏的红绿灯压在阅读页左上角，工具栏要让开
const isMac = navigator.userAgent.includes('Mac');

export default function Reader() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>();
  const nav = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const appDark = useTheme((s) => s.dark);
  const [commentPara, setCommentPara] = useState<{ index: number; text: string; count: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 沉浸模式：往下读时收起工具栏，往上滚或鼠标移到上下边缘时出现
  const [chromeVisible, setChromeVisible] = useState(true);
  const [fullScreen, setFullScreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const lastTopRef = useRef(0);

  const {
    currentChapter, content, fontCss, paraIdx, commentStats, loading, settings,
    loadChapters, loadContent, nextChapter, prevChapter, loadSettings,
  } = useReader();

  const updateProgress = useBookshelf((s) => s.updateProgress);
  const savePosition = useBookshelf((s) => s.savePosition);

  // 打开阅读页时记下书架上的章内位置。必须在挂载时取：之后换章会把它清零
  const restoreRef = useRef<{ chapterId: string; para: number } | null | undefined>(undefined);
  if (restoreRef.current === undefined) {
    const item = useBookshelf.getState().items.find((i) => i.book.id === bookId);
    restoreRef.current = item?.lastReadParaIndex ? { chapterId: item.lastReadChapterId, para: item.lastReadParaIndex } : null;
  }
  // 当前视口顶部是第几段；滚动停下后再写盘
  const posRef = useRef(0);
  const saveTimer = useRef<number>();
  const savePosRef = useRef(() => {});
  savePosRef.current = () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const ch = useReader.getState().currentChapter;
    if (bookId && ch) savePosition(bookId, ch.id, posRef.current);
  };

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    api.isFullScreen().then(setFullScreen);
    return api.onFullScreenChange(setFullScreen);
  }, []);

  const measure = () => {
    const body = bodyRef.current;
    if (!body) return;
    const max = body.scrollHeight - body.clientHeight;
    setProgress(max > 0 ? Math.min(1, body.scrollTop / max) : 1);
  };

  useEffect(() => {
    if (!bookId) return;
    loadChapters(bookId).then(() => {
      const ch = useReader.getState().chapters;
      const target = ch.find((c) => c.id === chapterId) || ch[0];
      if (target) loadContent(target);
    });
  }, [bookId, chapterId, loadChapters, loadContent]);

  useEffect(() => {
    if (currentChapter && bookId) {
      const { chapters: list } = useReader.getState();
      const index = list.findIndex((c) => c.id === currentChapter.id);
      updateProgress(bookId, currentChapter.id, currentChapter.title, Math.max(index, 0), list.length);
    }
  }, [currentChapter, bookId, updateProgress]);

  useEffect(() => {
    setCommentPara(null);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    posRef.current = 0;
    const body = bodyRef.current;
    if (!body || !content) return;
    const r = restoreRef.current;
    restoreRef.current = null;
    const el = r && r.chapterId === useReader.getState().currentChapter?.id
      ? body.querySelectorAll<HTMLElement>('.reader-para')[r.para]
      : undefined;
    if (el) {
      body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top;
      posRef.current = r!.para;
    } else {
      body.scrollTo(0, 0);
      setChromeVisible(true);
    }
    lastTopRef.current = body.scrollTop;
    measure();
  }, [content]);

  // 离开阅读页时把还没写盘的位置存下来，并清掉正文：下次打开时旧正文不能抢先消耗待恢复的位置
  useEffect(() => () => {
    if (saveTimer.current) savePosRef.current();
    useReader.setState({ currentChapter: null, content: '', fontCss: '', paraIdx: [], commentStats: {} });
  }, []);

  const onScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const top = body.getBoundingClientRect().top;
    const paras = body.querySelectorAll('.reader-para');
    let i = 0;
    while (i < paras.length - 1 && paras[i].getBoundingClientRect().bottom <= top + 1) i++;
    posRef.current = i;

    const st = body.scrollTop;
    const delta = st - lastTopRef.current;
    lastTopRef.current = st;
    // 章首、往回滚、读到章末（方便点下一章）时显示
    if (st < 24 || delta < -4 || st >= body.scrollHeight - body.clientHeight - 2) setChromeVisible(true);
    else if (delta > 4) setChromeVisible(false);
    measure();

    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => savePosRef.current(), 600);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 段评抽屉打开时，方向键和 Esc 留给抽屉；带修饰键的组合留给系统
      if (commentPara || e.metaKey || e.ctrlKey || e.altKey) return;
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
      const body = bodyRef.current;
      if (!body) return;
      // 翻一屏时留出约两行重叠，方便接上文
      const overlap = settings.fontSize * settings.lineHeight * 2;
      const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
      const scroll = (top: number) => {
        e.preventDefault();
        body.scrollBy({ top, behavior: 'smooth' });
      };
      switch (e.key) {
        case 'ArrowDown': return scroll(60);
        case 'ArrowUp': return scroll(-60);
        case 'ArrowRight': return void nextChapter();
        case 'ArrowLeft': return void prevChapter();
        case 'PageUp': return scroll(-(body.clientHeight - overlap));
        case 'PageDown':
        case ' ':
          if (e.key === ' ' && e.shiftKey) return scroll(-(body.clientHeight - overlap));
          // 已经到章末，再按一次进入下一章
          if (atBottom) {
            e.preventDefault();
            return void nextChapter();
          }
          return scroll(body.clientHeight - overlap);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [nextChapter, prevChapter, nav, commentPara, settingsOpen, fullScreen, settings.fontSize, settings.lineHeight]);

  const fontStack = FONTS.find((f) => f.value === settings.fontFamily)?.css || FONTS[0].css;
  // 反爬字体（如有）排在最前面负责解码，其余字形落到用户选的字体
  const fontFamily = fontCss
    ? fontCss.match(/font-family:\s*([^;,}]+)/)?.[1]?.trim() + ', ' + fontStack
    : fontStack;
  // 阅读主题只作用于阅读页；antd 浮层（Aa 面板、段评抽屉）挂在容器内，才能拿到同一套颜色变量
  const readerDark = settings.theme === 'night' || (settings.theme === 'auto' && appDark);
  const showChrome = chromeVisible || settingsOpen;

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
        {fontCss && <style dangerouslySetInnerHTML={{ __html: fontCss }} />}
        <div
          className={`reader-header${showChrome ? '' : ' hidden'}`}
          style={isMac && !fullScreen ? { paddingLeft: 88 } : undefined}
        >
          <button className="reader-tool" onClick={() => nav(-1)}>← 返回</button>
          <span className="reader-title">{currentChapter?.title || ''}</span>
          <div className="reader-tools">
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
          {loading ? (
            <div className="loading">加载中...</div>
          ) : (
            <div
              className="reader-text"
              style={{
                fontSize: settings.fontSize,
                lineHeight: settings.lineHeight,
                fontFamily,
                ['--reader-width' as string]: `${settings.pageWidth}px`,
              }}
            >
              <h2 style={{ fontSize: settings.fontSize + 4, marginBottom: 24, fontWeight: 600 }}>
                {currentChapter?.title}
              </h2>
              {content
                ? splitParagraphs(content).map(({ text, line: i }) => {
                  const idx = paraIdx[i] ?? -1;
                  const count = commentStats[idx] || 0;
                  return (
                    <p key={i} className="reader-para">
                      {idx >= 0 ? (
                        <>
                          {text.slice(0, -1)}
                          {/* 气泡和最后一个字绑在一起，避免单独掉到下一行；没有段评的段落悬停才显示 */}
                          <span className="para-tail">
                            {text.slice(-1)}
                            <button
                              className={`para-comment${count ? '' : ' empty'}`}
                              title={count ? '查看段评' : '写段评'}
                              onClick={() => setCommentPara({ index: idx, text, count })}
                            >
                              {count ? (count > 999 ? '999+' : count) : <CommentOutlined />}
                            </button>
                          </span>
                        </>
                      ) : text}
                    </p>
                  );
                })
                : '暂无内容'}
            </div>
          )}
        </div>

        {content && !loading && <div className="reader-progress">本章 {Math.round(progress * 100)}%</div>}

        <div className={`reader-nav${showChrome ? '' : ' hidden'}`}>
          <button onClick={prevChapter}>上一章</button>
          <button onClick={() => nav(`/book/${bookId}`)}>目录</button>
          <button onClick={nextChapter}>下一章</button>
        </div>

        {bookId && currentChapter && (
          <CommentDrawer
            bookId={bookId}
            itemId={currentChapter.id}
            para={commentPara}
            onClose={() => setCommentPara(null)}
            onPosted={(idx) => {
              useReader.setState((st) => ({
                commentStats: { ...st.commentStats, [idx]: (st.commentStats[idx] || 0) + 1 },
              }));
              setCommentPara((p) => p && { ...p, count: p.count + 1 });
            }}
          />
        )}
      </div>
    </ConfigProvider>
  );
}
