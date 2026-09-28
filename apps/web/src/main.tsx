import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import './styles/global.css';
import './styles/layout.css';
import './styles/components.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Do not retry client errors (403, 404, validation); retry transient ones once.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});

const updateSW = registerSW({
  onNeedRefresh() {
    if (window.confirm('يتوفر إصدار جديد من النظام. هل تريد التحديث الآن؟')) void updateSW(true);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
