import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { KeyboardProvider } from './state/keyboard.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KeyboardProvider>
      <App />
    </KeyboardProvider>
  </StrictMode>,
);
