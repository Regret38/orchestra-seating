import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './app/AppContext';
import { App } from './app/App';
import '@fontsource-variable/noto-sans-kr';
import './styles.css';

class ErrorBoundary extends Component<{children: ReactNode}, {error: boolean}> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    return this.state.error ? <main className="auth-card"><h1>화면을 열지 못했어요</h1><p>저장된 배치는 유지됩니다. 새로고침 후 다시 시도해 주세요.</p><button onClick={() => location.reload()}>새로고침</button></main> : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<ErrorBoundary><AppProvider><App/></AppProvider></ErrorBoundary>);
