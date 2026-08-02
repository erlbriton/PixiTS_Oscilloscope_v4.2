// src/main.ts

import './styles/oscilloscope.css';
import { Oscilloscope } from './Oscilloscope';

console.log('Oscilloscope starting...');

const startApp = () => {
    const oscilloscope = new Oscilloscope();
    oscilloscope.initialize();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}
