import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Button, Drawer, Input, Segmented, Spin, message } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { LikeFilled, LikeOutlined, UserOutlined } from '@ant-design/icons';
import type { ParaComment } from '@/types';
import * as api from '@/services/api';
import { useAccount } from '@/stores/account';

interface Props {
  bookId: string;
  itemId: string;
  /** 打开的段落；null 表示关闭 */
  para: { index: number; text: string; count: number } | null;
  onClose: () => void;
  /** 发了一条新段评，用来给正文里的气泡数 +1 */
  onPosted: (paraIndex: number) => void;
}

/** 回复对象：root 是一级评论，target 是实际被回复的那条（可能就是 root） */
interface ReplyTarget {
  root: ParaComment;
  target: ParaComment;
}

const Ctx = createContext<{ bookId: string; onReply: (root: ParaComment, target: ParaComment) => void }>({
  bookId: '',
  onReply: () => {},
});

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

/** 未登录时弹出登录框，返回是否已登录 */
function requireLogin() {
  const { user, openLogin } = useAccount.getState();
  if (!user) openLogin();
  return !!user;
}

function LikeButton({ c }: { c: ParaComment }) {
  const { bookId } = useContext(Ctx);
  const [liked, setLiked] = useState(c.liked);
  const [count, setCount] = useState(c.diggCount);
  const [busy, setBusy] = useState(false);

  // 先改界面再发请求，失败就改回去
  const toggle = async () => {
    if (busy || !requireLogin()) return;
    const next = !liked;
    const delta = next ? 1 : -1;
    setLiked(next);
    setCount((n) => Math.max(0, n + delta));
    setBusy(true);
    try {
      await api.commentDigg(bookId, c.id, next, c.isReply, c.serviceId);
    } catch (err) {
      setLiked(!next);
      setCount((n) => Math.max(0, n - delta));
      message.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className={`cmt-digg${liked ? ' liked' : ''}`} onClick={toggle} title={liked ? '取消点赞' : '点赞'}>
      {liked ? <LikeFilled /> : <LikeOutlined />} {count || ''}
    </button>
  );
}

function CommentItem({ c, root, children }: { c: ParaComment; root: ParaComment; children?: React.ReactNode }) {
  const { onReply } = useContext(Ctx);
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
          <button className="cmt-action" onClick={() => onReply(root, c)}>回复</button>
          <LikeButton c={c} />
        </div>
        {children}
      </div>
    </div>
  );
}

/** 某条评论下的回复：点开才加载；mine 是刚发的回复，始终显示在最前 */
function Replies({ comment, mine }: { comment: ParaComment; mine: ParaComment[] }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<ParaComment[]>([]);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!comment.replyCount && !mine.length) return null;

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

  const mineIds = new Set(mine.map((r) => r.id));
  const shown = [...mine, ...(open ? replies.filter((r) => !mineIds.has(r.id)) : [])];

  return (
    <>
      {shown.length > 0 && (
        <div className="cmt-replies">
          {shown.map((r) => <CommentItem key={r.id} c={r} root={comment} />)}
          {open && loading && <Spin size="small" />}
          {open && error && <div className="cmt-error">{error}</div>}
          {open && !loading && hasMore && <button className="cmt-link" onClick={load}>{error ? '重试' : '更多回复'}</button>}
          {open && !loading && !hasMore && replies.length > 0 && (
            <button className="cmt-link" onClick={() => setOpen(false)}>收起回复</button>
          )}
        </div>
      )}
      {!open && comment.replyCount > 0 && (
        <button className="cmt-link" onClick={load}>查看 {comment.replyCount} 条回复</button>
      )}
      {open && loading && !shown.length && <Spin size="small" />}
    </>
  );
}

function Composer({
  para, itemId, bookId, replyTo, onCancelReply, onSent,
}: {
  para: NonNullable<Props['para']>;
  itemId: string;
  bookId: string;
  replyTo: ReplyTarget | null;
  onCancelReply: () => void;
  onSent: (c: ParaComment, replyTo: ReplyTarget | null) => void;
}) {
  const { user, openLogin } = useAccount();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextAreaRef>(null);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  if (!user) {
    return <button className="cmt-login" onClick={openLogin}>登录番茄账号后可发段评、点赞</button>;
  }

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const c = replyTo
        ? await api.commentReply(
          itemId, bookId, para.index, para.text, replyTo.root.id, replyTo.target.userId, content,
          replyTo.target.isReply ? replyTo.target.id : '',
        )
        : await api.commentAdd(itemId, bookId, para.index, para.text, content);
      // 服务端回包里用户信息不一定全，用本地账号补上
      onSent({
        ...c,
        text: c.text || content,
        time: c.time || Math.floor(Date.now() / 1000),
        userName: c.userName && c.userName !== '番茄用户' ? c.userName : user.name,
        avatar: c.avatar || user.avatar,
        replyTo: c.replyTo || (replyTo?.target.isReply ? replyTo.target.userName : ''),
      }, replyTo);
      setText('');
      message.success(replyTo ? '回复已发布' : '段评已发布');
    } catch (err) {
      message.error(errMsg(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="cmt-composer">
      {replyTo && (
        <div className="cmt-replying">
          <span>回复 {replyTo.target.userName}</span>
          <button className="cmt-action" onClick={onCancelReply}>取消</button>
        </div>
      )}
      <div className="cmt-input-row">
        <Input.TextArea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          }}
          autoSize={{ minRows: 1, maxRows: 5 }}
          maxLength={1000}
          placeholder={replyTo ? `回复 ${replyTo.target.userName}` : '说说你对这段的看法'}
        />
        <Button type="primary" loading={sending} disabled={!text.trim()} onClick={send}>发送</Button>
      </div>
      <div className="cmt-hint">⌘ + Enter 发送 · 会以你的番茄账号公开发布</div>
    </div>
  );
}

export default function CommentDrawer({ bookId, itemId, para, onClose, onPosted }: Props) {
  const { ready, init } = useAccount();
  const [sort, setSort] = useState(1);
  const [comments, setComments] = useState<ParaComment[]>([]);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  // 自己刚发的回复，按一级评论 id 归档
  const [myReplies, setMyReplies] = useState<Record<string, ParaComment[]>>({});
  // 切段落或排序后，丢弃还在路上的旧请求
  const gen = useRef(0);

  // 直接打开阅读器时账号状态可能还没恢复
  useEffect(() => {
    if (!ready) init();
  }, [ready, init]);

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
    setReplyTo(null);
    setMyReplies({});
    if (para) load(true);
    // 只按段落本身变化重载：发段评后 para.count 会变，不应触发重新拉列表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [para?.index, para?.text, sort, itemId]);

  const onReply = (root: ParaComment, target: ParaComment) => {
    if (requireLogin()) setReplyTo({ root, target });
  };

  const onSent = (c: ParaComment, to: ReplyTarget | null) => {
    if (to) {
      setMyReplies((prev) => ({ ...prev, [to.root.id]: [c, ...(prev[to.root.id] || [])] }));
      setReplyTo(null);
    } else if (para) {
      setComments((prev) => [c, ...prev]);
      onPosted(para.index);
    }
  };

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
      footer={para && (
        <Composer
          para={para}
          itemId={itemId}
          bookId={bookId}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSent={onSent}
        />
      )}
    >
      <Ctx.Provider value={{ bookId, onReply }}>
        {para && <blockquote className="cmt-quote">{para.text}</blockquote>}
        {comments.map((c) => (
          <CommentItem key={c.id} c={c} root={c}>
            <Replies comment={c} mine={myReplies[c.id] || []} />
          </CommentItem>
        ))}
      </Ctx.Provider>
      <div className="cmt-footer">
        {loading && <Spin />}
        {error && <div className="cmt-error">{error}</div>}
        {!loading && (hasMore || error) && (
          <button className="cmt-link" onClick={() => load(!!error && !comments.length)}>
            {error ? '重试' : '加载更多'}
          </button>
        )}
        {!loading && !error && !hasMore && comments.length > 0 && <span>没有更多了</span>}
        {!loading && !error && !comments.length && <span>还没有段评，来说第一句</span>}
      </div>
    </Drawer>
  );
}
