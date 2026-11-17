import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useReader } from '@/stores/reader';
import { useBookshelf } from '@/stores/bookshelf';
import CommentDrawer from '@/components/CommentDrawer';

export default function Reader() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>();
  const nav = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);
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

  const bgColor = settings.theme.bgColor;
  const textColor = settings.theme.textColor;

  const fontFamily = fontCss
    ? fontCss.match(/font-family:\s*([^;,}]+)/)?.[1]?.trim() + ', ' + settings.fontFamily
    : settings.fontFamily;

  return (
    <div className="reader-container" style={{ background: bgColor, color: textColor }}>
      {fontCss && <style dangerouslySetInnerHTML={{ __html: fontCss }} />}
      <div className="reader-header">
        <button onClick={() => nav(-1)}>← 返回</button>
        <span style={{ fontSize: 13 }}>{currentChapter?.title || ''}</span>
        <span />
      </div>

      <div className="reader-body" ref={bodyRef}>
        {loading ? (
          <div className="loading" style={{ color: textColor }}>加载中...</div>
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
                    {count > 0 ? (
                      <>
                        {text.slice(0, -1)}
                        {/* 气泡和最后一个字绑在一起，避免单独掉到下一行 */}
                        <span className="para-tail">
                          {text.slice(-1)}
                          <button
                            className="para-comment"
                            title="查看段评"
                            onClick={() => setCommentPara({ index: idx, text, count })}
                          >
                            {count > 999 ? '999+' : count}
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
        />
      )}
    </div>
  );
}
