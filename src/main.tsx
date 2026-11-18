import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import { useTheme, antdConfig } from './stores/theme';
import { installExternalLinks } from './services/native';
import './styles/index.css';

function Root() {
  const dark = useTheme((s) => s.dark);
  const init = useTheme((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <ConfigProvider locale={zhCN} theme={antdConfig(dark)}>
      <HashRouter>
        <App />
      </HashRouter>
    </ConfigProvider>
  );
}

installExternalLinks();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
