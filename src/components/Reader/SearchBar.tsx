import { useEffect, useRef, useState } from 'react';
import { CloseOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';

interface Props {
  onClose: () => void;
  /** 当前章的正文节点；章节变了或正文到了，传入的 version 会变，用来重新搜索 */
  getRoot: () => Element | null;
  version: unknown;
  /** 把命中滚到 / 翻到可见处 */
  onReveal: (range: Range) => void;
  /** 命中是否在当前阅读位置之后；新搜索从这里开始，不跳回章首 */
  isAhead: (range: Range) => boolean;
}

/** 在一章正文里找所有命中。段评气泡里的数字不算正文，跳过 */
function findAll(root: Element, query: string): Range[] {
  const q = query.toLowerCase();
  const out: Range[] = [];
  root.querySelectorAll('.reader-para').forEach((p) => {
    // 一段可能被拆成几个文本节点（最后一个字和段评气泡绑在一起），拼起来再找，命中可以跨节点
    const nodes: { node: Text; start: number }[] = [];
    let text = '';
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest('button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n as Text, start: text.length });
      text += n.nodeValue || '';
    }
    const lower = text.toLowerCase();
    const at = (pos: number) => {
      let i = nodes.length - 1;
      while (i > 0 && nodes[i].start > pos) i--;
      return { node: nodes[i].node, offset: pos - nodes[i].start };
    };
    for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
      const s = at(i);
      const e = at(i + q.length - 1);
      const r = document.createRange();
      r.setStart(s.node, s.offset);
      r.setEnd(e.node, e.offset + 1);
      out.push(r);
    }
  });
  return out;
}

/** ⌘F 章内搜索：边输入边高亮全部命中，回车 / Shift+回车逐个跳，Esc 关闭 */
export default function SearchBar({ onClose, getRoot, version, onReveal, isAhead }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Range[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const revealRef = useRef({ onReveal, isAhead });
  revealRef.current = { onReveal, isAhead };

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      CSS.highlights.delete('reader-search');
      CSS.highlights.delete('reader-search-current');
    };
  }, []);

  // 关键词、章节或正文变化后重新搜索；停止输入 150ms 后再搜，跳到当前位置之后的第一处
  const queryRef = useRef('');
  useEffect(() => {
    const t = window.setTimeout(() => {
      const root = getRoot();
      const list = query && root ? findAll(root, query) : [];
      setHits(list);
      if (queryRef.current === query) {
        // 只是正文重排（同一个关键词）时保留当前序号，不打断用户
        setIdx((i) => Math.min(i, Math.max(0, list.length - 1)));
      } else {
        const first = Math.max(0, list.findIndex(revealRef.current.isAhead));
        setIdx(first);
        if (list[first]) revealRef.current.onReveal(list[first]);
      }
      queryRef.current = query;
    }, 150);
    return () => window.clearTimeout(t);
  }, [query, version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    CSS.highlights.set('reader-search', new Highlight(...hits));
    if (hits[idx]) CSS.highlights.set('reader-search-current', new Highlight(hits[idx]));
    else CSS.highlights.delete('reader-search-current');
  }, [hits, idx]);

  const go = (dir: 1 | -1) => {
    if (!hits.length) return;
    const next = (idx + dir + hits.length) % hits.length;
    setIdx(next);
    onReveal(hits[next]);
  };

  return (
    <div className="reader-search" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={query}
        placeholder="在本章中搜索"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go(e.shiftKey ? -1 : 1);
          else if (e.key === 'Escape') onClose();
          else return;
          e.preventDefault();
        }}
      />
      <span className="reader-search-count">
        {query ? (hits.length ? `${idx + 1}/${hits.length}` : '无结果') : ''}
      </span>
      <button title="上一处（Shift+回车）" disabled={!hits.length} onClick={() => go(-1)}><UpOutlined /></button>
      <button title="下一处（回车）" disabled={!hits.length} onClick={() => go(1)}><DownOutlined /></button>
      <button title="关闭（Esc）" onClick={onClose}><CloseOutlined /></button>
    </div>
  );
}

/** 外部想重新聚焦搜索框（再按 ⌘F）时用 */
export function focusSearch() {
  const el = document.querySelector<HTMLInputElement>('.reader-search input');
  el?.focus();
  el?.select();
}
