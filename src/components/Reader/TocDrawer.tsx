import { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer, Input } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import type { Chapter } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  bookTitle: string;
  chapters: Chapter[];
  currentId: string;
  onSelect: (chapter: Chapter) => void;
  /** macOS 非全屏时，抽屉顶部要让开红绿灯 */
  topInset: boolean;
}

const ROW = 40;

/** 阅读页左侧目录。几千章的书只渲染视口附近的行 */
export default function TocDrawer({ open, onClose, bookTitle, chapters, currentId, onSelect, topInset }: Props) {
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const listRef = useRef<HTMLDivElement>(null);

  // 关键字匹配章节名；纯数字同时匹配章节序号，回车直接跳过去
  const list = useMemo(() => {
    const q = query.trim();
    const all = chapters.map((c, i) => ({ c, n: i + 1 }));
    if (!q) return all;
    return all.filter(({ c, n }) => c.title.includes(q) || String(n) === q);
  }, [chapters, query]);

  // 打开时清空搜索，并把当前章滚到列表中间
  useEffect(() => {
    if (!open) return;
    setQuery('');
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      setHeight(el.clientHeight);
      const i = chapters.findIndex((c) => c.id === currentId);
      el.scrollTop = Math.max(0, i * ROW - el.clientHeight / 2 + ROW / 2);
      setScrollTop(el.scrollTop);
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = Math.max(0, Math.floor(scrollTop / ROW) - 10);
  const end = Math.min(list.length, Math.ceil((scrollTop + height) / ROW) + 10);

  const pick = (c: Chapter) => {
    onSelect(c);
    onClose();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="left"
      width={340}
      className={`toc-drawer${topInset ? ' inset' : ''}`}
      title={<span className="toc-title">{bookTitle || '目录'}</span>}
      extra={<span className="toc-count">共 {chapters.length} 章</span>}
      closable={false}
    >
      <div className="toc-search">
        <Input
          allowClear
          placeholder="搜索章节名，或输入章节序号"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (listRef.current) listRef.current.scrollTop = 0;
            setScrollTop(0);
          }}
          onPressEnter={() => list[0] && pick(list[0].c)}
        />
      </div>
      <div className="toc-list" ref={listRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {list.length === 0 ? (
          <div className="toc-empty">没有匹配的章节</div>
        ) : (
          <div style={{ height: list.length * ROW, position: 'relative' }}>
            {list.slice(start, end).map(({ c }, k) => (
              <button
                key={c.id}
                className={`toc-item${c.id === currentId ? ' active' : ''}`}
                style={{ top: (start + k) * ROW, height: ROW }}
                onClick={() => pick(c)}
              >
                <span className="toc-name">{c.title}</span>
                {c.isVip && <LockOutlined className="toc-lock" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
