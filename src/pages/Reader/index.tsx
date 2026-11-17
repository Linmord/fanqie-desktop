import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useReader } from '@/stores/reader';
import { useBookshelf } from '@/stores/bookshelf';
import { ConfigProvider, Popover } from 'antd';
import { CommentOutlined } from '@ant-design/icons';
import CommentDrawer from '@/components/CommentDrawer';
import SettingsPanel from '@/components/Reader/SettingsPanel';
import { FONTS } from '@/components/Reader/options';
import { useTheme, antdConfig } from '@/stores/theme';

export default function Reader() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>();
  const nav = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const appDark = useTheme((s) => s.dark);
  const [commentPara, setCommentPara] = useState<{ index: number; text: string; count: number } | null>(null);

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
    }
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
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => savePosRef.current(), 600);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 段评抽屉打开时，方向键和 Esc 留给抽屉
      if (commentPara) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextChapter();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prevChapter();
      if (e.key === 'Escape') nav(-1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [nextChapter, prevChapter, nav, commentPara]);

  const fontStack = FONTS.find((f) => f.value === settings.fontFamily)?.css || FONTS[0].css;
  // 反爬字体（如有）排在最前面负责解码，其余字形落到用户选的字体
  const fontFamily = fontCss
    ? fontCss.match(/font-family:\s*([^;,}]+)/)?.[1]?.trim() + ', ' + fontStack
    : fontStack;
  // 阅读主题只作用于阅读页；antd 浮层（Aa 面板、段评抽屉）挂在容器内，才能拿到同一套颜色变量
  const readerDark = settings.theme === 'night' || (settings.theme === 'auto' && appDark);

  return (
    <ConfigProvider theme={antdConfig(readerDark)} getPopupContainer={() => containerRef.current || document.body}>
      <div
        className="reader-container"
        ref={containerRef}
        data-reader-theme={settings.theme === 'auto' ? undefined : settings.theme}
      >
        {fontCss && <style dangerouslySetInnerHTML={{ __html: fontCss }} />}
        <div className="reader-header">
          <button onClick={() => nav(-1)}>← 返回</button>
          <span style={{ fontSize: 13 }}>{currentChapter?.title || ''}</span>
          <Popover content={<SettingsPanel />} trigger="click" placement="bottomRight" arrow={false}>
            <button className="reader-aa" title="阅读设置">Aa</button>
          </Popover>
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
                ? content.split('\n').map((text, i) => {
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

        <div className="reader-nav">
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
