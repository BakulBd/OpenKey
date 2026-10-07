import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './app/App.js';
import { registerServiceWorker } from './pwa.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

registerServiceWorker();
