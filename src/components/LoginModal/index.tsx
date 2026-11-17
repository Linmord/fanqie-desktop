import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Spin } from 'antd';
import * as api from '@/services/api';
import { useAccount } from '@/stores/account';
import { useBookshelf } from '@/stores/bookshelf';

type Phase = 'loading' | 'new' | 'scanned' | 'expired' | 'error';

const hints: Record<Phase, string> = {
  loading: '正在获取二维码…',
  new: '打开番茄小说 App，扫一扫登录',
  scanned: '已扫码，请在手机上确认登录',
  expired: '二维码已过期',
  error: '',
};

export default function LoginModal() {
  const { loginOpen, closeLogin, setUser } = useAccount();
  const [phase, setPhase] = useState<Phase>('loading');
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  // 每次刷新二维码递增，旧的轮询看到代数变了就自行停止
  const gen = useRef(0);

  const start = useCallback(async () => {
    const my = ++gen.current;
    setPhase('loading');
    setImage('');
    try {
      const { token, image: img } = await api.getQrcode();
      if (my !== gen.current) return;
      setImage(img);
      setPhase('new');

      while (my === gen.current) {
        await new Promise((r) => setTimeout(r, 2000));
        if (my !== gen.current) return;
        const res = await api.checkQrcode(token).catch(() => null);
        if (!res || my !== gen.current) continue;
        if (res.status === 'success') {
          gen.current++;
          setUser(res.user ?? null);
          closeLogin();
          useBookshelf.getState().uploadLocal();
          return;
        }
        if (res.status === 'error') {
          setError(res.message || '登录失败');
          setPhase('error');
          return;
        }
        setPhase(res.status);
        if (res.status === 'expired') return;
      }
    } catch (err) {
      if (my !== gen.current) return;
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));
      setPhase('error');
    }
  }, [setUser, closeLogin]);

  useEffect(() => {
    if (loginOpen) start();
    else gen.current++;
  }, [loginOpen, start]);

  const canRetry = phase === 'expired' || phase === 'error';

  return (
    <Modal open={loginOpen} onCancel={closeLogin} footer={null} width={420} centered destroyOnClose>
      <div className="login-modal">
        <h2 className="login-title">登录番茄账号</h2>
        <p className="login-sub">登录后书架和阅读进度与番茄小说 App 同步</p>
        <div className={`login-qrcode${phase === 'scanned' || canRetry ? ' dim' : ''}`}>
          {image ? <img src={image} alt="登录二维码" /> : <Spin />}
          {canRetry && (
            <button className="login-refresh" onClick={start}>刷新二维码</button>
          )}
        </div>
        <p className={`login-hint${phase === 'error' ? ' error' : ''}`}>
          {phase === 'error' ? error : hints[phase]}
        </p>
      </div>
    </Modal>
  );
}
