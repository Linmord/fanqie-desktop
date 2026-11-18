import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Search from './pages/Search';
import Bookshelf from './pages/Bookshelf';
import BookDetail from './pages/BookDetail';
import Reader from './pages/Reader';
import Moyu from './pages/Moyu';
import LoginModal from './components/LoginModal';

export default function App() {
  // 登录弹窗放在最外层：阅读器不在 Layout 里，点赞、发段评时也要能弹出来
  return (
    <>
      <Routes>
        <Route path="/reader/:bookId/:chapterId" element={<Reader />} />
        <Route path="/moyu/:bookId/:chapterId" element={<Moyu />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/bookshelf" element={<Bookshelf />} />
          <Route path="/book/:id" element={<BookDetail />} />
        </Route>
      </Routes>
      <LoginModal />
    </>
  );
}
