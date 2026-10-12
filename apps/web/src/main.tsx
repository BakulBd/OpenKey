import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './app/App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { registerServiceWorker } from './pwa.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={(e) => (
        <main className="prerender" role="alert">
          <h1>OpenKey could not start</h1>
          <p>
            Reload the page. If it keeps happening, report it with the details below; nothing was
            sent to your keyboard.
          </p>
          <button type="button" onClick={() => location.reload()}>
            Reload
          </button>
          <pre className="small">{e.message}</pre>
        </main>
      )}
    >
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);

registerServiceWorker();
