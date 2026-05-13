if (import.meta.env.DEV) import('react-grab');

import { createRoot } from 'react-dom/client';
import './style.css';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(<App />);
