import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { useAuth } from './store';
import { mulaiSync } from './sync';

// Sinkronisasi dimulai setelah pemeriksaan sesi selesai, supaya token yang ternyata ditolak
// tidak sempat dipakai memanggil /sync/pull dan /sales (401 sia-sia di konsol).
void useAuth.getState().muatUlangUser().then(mulaiSync);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
