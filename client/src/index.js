import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import './fonts/Mabry Pro/stylesheet.css'; // Import Mabry Pro font
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://cra.link/PWA
serviceWorkerRegistration.register();
