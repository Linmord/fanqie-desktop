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

  const { updateProgress } = useBookshelf();

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
    bodyRef.current?.scrollTo(0, 0);
    setCommentPara(null);
  }, [content]);

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

        <div className="reader-body" ref={bodyRef}>
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
