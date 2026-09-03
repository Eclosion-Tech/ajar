import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { store } from './stdb';
import './styles.css';

// The import lab and deterministic showcase are deliberately local-only and
// do not need a table server. Connect lazily when the real app is requested.
const connectForRemoteRoute = () => {
  if (!window.location.hash.startsWith('#/demo') && !window.location.hash.startsWith('#/lab')) {
    store.connect();
  }
};

connectForRemoteRoute();
window.addEventListener('hashchange', connectForRemoteRoute);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
