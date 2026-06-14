import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Providers } from '@/components/Providers';
import '@/lib/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>,
);
