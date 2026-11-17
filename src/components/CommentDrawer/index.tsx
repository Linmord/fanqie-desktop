import { useEffect, useRef, useState } from 'react';
import { Drawer, Segmented, Spin } from 'antd';
import { LikeOutlined, UserOutlined } from '@ant-design/icons';
import type { ParaComment } from '@/types';
import * as api from '@/services/api';

interface Props {
  bookId: string;
  itemId: string;
  /** 打开的段落；null 表示关闭 */
  para: { index: number; text: string; count: number } | null;
  onClose: () => void;
}

function formatTime(ts: number) {
  if (!ts) return '';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  const d = new Date(ts * 1000);
  const md = `${d.getMonth() + 1}-${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}-${md}`;
}

function errMsg(err: unknown) {
  return String((err as Error)?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function CommentItem({ c, children }: { c: ParaComment; children?: React.ReactNode }) {
  return (
    <div className="cmt-item">
      {c.avatar ? (
        <img className="cmt-avatar" src={c.avatar} referrerPolicy="no-referrer" alt="" />
      ) : (
        <span className="cmt-avatar cmt-avatar-empty"><UserOutlined /></span>
      )}
      <div className="cmt-main">
        <div className="cmt-user">
          <span className="cmt-name">{c.userName}</span>
          {c.isAuthor && <span className="cmt-tag author">作者</span>}
          {c.isVip && <span className="vip-badge">VIP</span>}
          {c.titles.slice(0, 1).map((t) => <span key={t} className="cmt-tag">{t}</span>)}
        </div>
        <div className="cmt-text">
          {c.replyTo && <span className="cmt-reply-to">回复 {c.replyTo}：</span>}
          {c.text}
        </div>
        <div className="cmt-meta">
          <span>{formatTime(c.time)}</span>
          {c.authorLiked && <span className="cmt-author-liked">作者赞过</span>}
          <span className="cmt-digg"><LikeOutlined /> {c.diggCount || ''}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 某条评论下的回复：点开才加载 */
function Replies({ comment }: { comment: ParaComment }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<ParaComment[]>([]);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!comment.replyCount) return null;

  const load = async () => {
    setOpen(true);
    setLoading(true);
    setError('');
    try {
      const page = await api.commentReplies(comment.id, cursor);
      setReplies((prev) => [...prev, ...page.replies]);
      setCursor(page.cursor);
      setHasMore(page.hasMore && page.replies.length > 0);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return <button className="cmt-link" onClick={load}>查看 {comment.replyCount} 条回复</button>;
  }
  return (
    <div className="cmt-replies">
      {replies.map((r) => <CommentItem key={r.id} c={r} />)}
      {loading && <Spin size="small" />}
      {error && <div className="cmt-error">{error}</div>}
      {!loading && hasMore && <button className="cmt-link" onClick={load}>{error ? '重试' : '更多回复'}</button>}
      {!loading && !hasMore && <button className="cmt-link" onClick={() => setOpen(false)}>收起回复</button>}
    </div>
  );
}

export default function CommentDrawer({ bookId, itemId, para, onClose }: Props) {
  const [sort, setSort] = useState(1);
  const [comments, setComments] = useState<ParaComment[]>([]);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 切段落或排序后，丢弃还在路上的旧请求
  const gen = useRef(0);

  const load = async (reset: boolean) => {
    if (!para) return;
    const my = reset ? ++gen.current : gen.current;
    setLoading(true);
    setError('');
    try {
      const page = await api.commentList(itemId, bookId, para.index, reset ? '' : cursor, sort);
      if (my !== gen.current) return;
      setComments((prev) => (reset ? page.comments : [...prev, ...page.comments]));
      setCursor(page.cursor);
      setHasMore(page.hasMore && page.comments.length > 0);
    } catch (err) {
      if (my === gen.current) setError(errMsg(err));
    } finally {
      if (my === gen.current) setLoading(false);
    }
  };

  useEffect(() => {
    setComments([]);
    setCursor('');
    setHasMore(false);
    if (para) load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [para, sort, itemId]);

  return (
    <Drawer
      open={!!para}
      onClose={onClose}
      width={420}
      className="comment-drawer"
      title={`段评 ${para?.count || ''}`}
      extra={
        <Segmented
          size="small"
          value={sort}
          onChange={(v) => setSort(Number(v))}
          options={[{ label: '热门', value: 1 }, { label: '最新', value: 3 }]}
        />
      }
    >
      {para && <blockquote className="cmt-quote">{para.text}</blockquote>}
      {comments.map((c) => (
        <CommentItem key={c.id} c={c}>
          <Replies comment={c} />
        </CommentItem>
      ))}
      <div className="cmt-footer">
        {loading && <Spin />}
        {error && <div className="cmt-error">{error}</div>}
        {!loading && (hasMore || error) && (
          <button className="cmt-link" onClick={() => load(!!error && !comments.length)}>
            {error ? '重试' : '加载更多'}
          </button>
        )}
        {!loading && !error && !hasMore && comments.length > 0 && <span>没有更多了</span>}
        {!loading && !error && !comments.length && <span>暂无段评</span>}
      </div>
    </Drawer>
  );
}
