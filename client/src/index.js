import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import './fonts/Mabry Pro/stylesheet.css'; // Import Mabry Pro font

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);