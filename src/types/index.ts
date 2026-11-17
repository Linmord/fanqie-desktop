/** 书籍信息 */
export interface Book {
  id: string;
  title: string;
  author: string;
  cover: string;
  description: string;
  category: string;
  wordCount: number;
  status: '连载中' | '已完结';
  latestChapter: string;
}

/** 章节信息 */
export interface Chapter {
  id: string;
  title: string;
  bookId: string;
  index: number;
  content?: string;
  isVip: boolean;
}

/** 搜索结果 */
export interface SearchResult {
  books: Book[];
  total: number;
  hasMore: boolean;
}

/** 书架条目 */
export interface BookshelfItem {
  book: Book;
  lastReadChapterId: string;
  lastReadChapterTitle: string;
  progress: number;
  addedAt: string;
  updatedAt: string;
}

/** 全应用外观模式 */
export type Appearance = 'system' | 'light' | 'dark';

/** 阅读器主题 */
export interface ReaderTheme {
  name: string;
  bgColor: string;
  textColor: string;
}

/** 阅读模式 */
export type ReadingMode = 'scroll' | 'page';

/** 阅读器设置 */
export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  pageWidth: number;
  theme: ReaderTheme;
  fontFamily: string;
  readingMode: ReadingMode;
}

/** 番茄账号 */
export interface FanqieUser {
  id: string;
  name: string;
  avatar: string;
  isVip: boolean;
}

/** 扫码状态 */
export interface QrcodeStatus {
  status: 'new' | 'scanned' | 'expired' | 'success' | 'error';
  user?: FanqieUser | null;
  message?: string;
}

/** 章节正文；paraIdx 与 content 按行一一对应，是段评用的段落序号 */
export interface ChapterContent {
  content: string;
  fontCss: string;
  paraIdx?: number[];
}

/** 段评或回复 */
export interface ParaComment {
  id: string;
  isReply: boolean;
  userId: string;
  serviceId: number;
  /** 当前登录账号是否赞过 */
  liked: boolean;
  text: string;
  time: number;
  userName: string;
  avatar: string;
  isAuthor: boolean;
  isVip: boolean;
  titles: string[];
  diggCount: number;
  replyCount: number;
  authorLiked: boolean;
  replyTo: string;
}

export interface CommentPage {
  comments: ParaComment[];
  cursor: string;
  hasMore: boolean;
  total: number;
}

export interface ReplyPage {
  replies: ParaComment[];
  cursor: string;
  hasMore: boolean;
}
