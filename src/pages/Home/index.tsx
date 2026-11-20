import { useEffect, useState } from 'react';
import BookCard from '@/components/BookCard';
import * as api from '@/services/api';
import type { Book } from '@/types';

type CategoryGroup = Awaited<ReturnType<typeof api.categories>>[number];
type RecommendSection = Awaited<ReturnType<typeof api.recommend>>[number];

const RECOMMEND = 'recommend';
const TOP = 'top';
// 与官网排行页一致：2 阅读榜，1 新书榜
const RANK_MOLDS = [
  { id: '2', name: '阅读榜' },
  { id: '1', name: '新书榜' },
];

// 推荐页先用上次的结果秒开，后台再刷新
const RECOMMEND_CACHE_KEY = 'fanqie.recommend';

function readRecommendCache(): RecommendSection[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECOMMEND_CACHE_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function Recommend() {
  const [sections, setSections] = useState<RecommendSection[]>(readRecommendCache);
  const [loading, setLoading] = useState(sections.length === 0);

  useEffect(() => {
    api.recommend().then((list) => {
      if (list.length > 0) {
        setSections(list);
        try {
          localStorage.setItem(RECOMMEND_CACHE_KEY, JSON.stringify(list));
        } catch { /* 存不下就算了，只是少了秒开 */ }
      }
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="loading">加载中...</div>;
  if (sections.length === 0) {
    return <div className="empty-state"><p>暂无内容，请稍后再试</p></div>;
  }
  return (
    <>
      {sections.map((s) => (
        <section key={s.title} className="discover-section">
          <h2 className="section-title">{s.title}</h2>
          <div className="book-grid">
            {s.books.map((book) => <BookCard key={book.id} book={book} />)}
          </div>
        </section>
      ))}
    </>
  );
}

function Ranking({ rankId }: { rankId: string }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.ranking(rankId, page).then((res) => {
      if (cancelled) return;
      setBooks((prev) => {
        if (page === 0) return res.books;
        const seen = new Set(prev.map((b) => b.id));
        return [...prev, ...res.books.filter((b) => !seen.has(b.id))];
      });
      setHasMore(res.hasMore);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [rankId, page]);

  if (books.length === 0) {
    return loading
      ? <div className="loading">加载中...</div>
      : <div className="empty-state"><p>暂无内容，请稍后再试</p></div>;
  }
  return (
    <>
      <div className="book-grid">
        {books.map((book) => <BookCard key={book.id} book={book} />)}
      </div>
      {loading ? (
        <div className="loading">加载中...</div>
      ) : hasMore && (
        <div className="load-more">
          <button className="btn-secondary" onClick={() => setPage((p) => p + 1)}>加载更多</button>
        </div>
      )}
    </>
  );
}

export default function Home() {
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [tab, setTab] = useState(RECOMMEND);
  const [mold, setMold] = useState(RANK_MOLDS[0].id);
  const [categoryId, setCategoryId] = useState('');

  useEffect(() => {
    api.categories().then(setGroups);
  }, []);

  const group = groups.find((g) => g.id === tab);

  const selectTab = (id: string) => {
    setTab(id);
    const first = groups.find((g) => g.id === id)?.children[0]?.id;
    if (first) setCategoryId(first);
  };

  return (
    <div>
      <h1 className="page-title">发现好书</h1>

      <div className="category-tabs">
        {[{ id: RECOMMEND, name: '推荐' }, { id: TOP, name: '巅峰榜' }, ...groups].map((g) => (
          <button
            key={g.id}
            className={`category-tab${tab === g.id ? ' active' : ''}`}
            onClick={() => selectTab(g.id)}
          >
            {g.name}
          </button>
        ))}
        {group && (
          <div className="rank-molds">
            {RANK_MOLDS.map((m) => (
              <button
                key={m.id}
                className={`category-tab${mold === m.id ? ' active' : ''}`}
                onClick={() => setMold(m.id)}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {group && (
        <div className="category-tabs">
          {group.children.map((cat) => (
            <button
              key={cat.id}
              className={`category-tab${categoryId === cat.id ? ' active' : ''}`}
              onClick={() => setCategoryId(cat.id)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {tab === TOP ? (
        <Ranking key={TOP} rankId={TOP} />
      ) : group && categoryId ? (
        // 用 key 让换榜单时从第一页重新加载
        <Ranking key={`${group.id}_${mold}_${categoryId}`} rankId={`${group.id}_${mold}_${categoryId}`} />
      ) : (
        <Recommend />
      )}
    </div>
  );
}
