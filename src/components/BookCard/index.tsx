import { useNavigate } from 'react-router-dom';
import type { Book } from '@/types';

export default function BookCard({ book }: { book: Book }) {
  const nav = useNavigate();

  return (
    <div className="book-card" onClick={() => nav(`/book/${book.id}`)}>
      <img
        className="book-cover"
        src={book.cover || undefined}
        alt={book.title}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
      <div className="book-title" title={book.title}>{book.title}</div>
      <div className="book-author">{book.author}</div>
    </div>
  );
}
