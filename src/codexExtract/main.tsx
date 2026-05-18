import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CodexExtractApp } from './CodexExtractApp';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <CodexExtractApp />
    </StrictMode>
  );
}
