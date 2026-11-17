import { Modal } from 'antd';
import { GithubOutlined, MessageOutlined } from '@ant-design/icons';
import logo from '@/assets/logo.png';

const REPO = 'https://github.com/MoYiC6/fanqie-desktop';

const references = [
  { name: 'Jees996/fanqie-novel-downloader', url: 'https://github.com/Jees996/fanqie-novel-downloader', note: 'App 接口签名与正文解密' },
  { name: 'naiyQAQ/fanqie-assistant', url: 'https://github.com/naiyQAQ/fanqie-assistant', note: '上游参考的加解密实现' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

// 外链统一 target=_blank，由主进程 setWindowOpenHandler 交给系统浏览器打开
export default function AboutModal({ open, onClose }: Props) {
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={440} centered>
      <div className="about-modal">
        <img className="about-logo" src={logo} alt="" />
        <h2 className="about-title">番茄小说桌面版</h2>
        <p className="about-version">v{__APP_VERSION__} · 开源 · MIT 协议</p>

        <p className="about-desc">
          这是一个开源的非官方第三方客户端，全部代码公开在 GitHub。欢迎 Star、反馈问题或参与贡献。
        </p>

        <div className="about-actions">
          <a className="about-btn primary" href={REPO} target="_blank" rel="noreferrer">
            <GithubOutlined /> GitHub 开源地址
          </a>
          <a className="about-btn" href={`${REPO}/issues`} target="_blank" rel="noreferrer">
            <MessageOutlined /> 反馈问题
          </a>
        </div>

        <section className="about-section">
          <h3>参考的开源项目</h3>
          <ul>
            {references.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer">{r.name}</a>
                <span>{r.note}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="about-section">
          <h3>免责声明</h3>
          <p>
            本软件与番茄小说及北京字节跳动科技有限公司无任何关联，仅供学习与技术研究，严禁商用。本软件不存储、不分发任何小说内容，作品版权归作者和平台所有，请支持正版。
            <a href={`${REPO}/blob/main/DISCLAIMER.md`} target="_blank" rel="noreferrer">完整声明</a>
          </p>
        </section>
      </div>
    </Modal>
  );
}
