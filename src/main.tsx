import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

function applyInterfaceDensity() {
  const isLaptopViewport = window.innerWidth >= 1024;
  const isHighDisplayScale = window.devicePixelRatio >= 1.45;
  const isNarrowMobileViewport = window.innerWidth <= 430;
  const isHighDensityMobile = window.devicePixelRatio >= 1.75;

  document.documentElement.classList.toggle('atlaix-compact-ui', isLaptopViewport && isHighDisplayScale);
  document.documentElement.classList.toggle('atlaix-mobile-compact', isNarrowMobileViewport && isHighDensityMobile);
}

applyInterfaceDensity();
window.addEventListener('resize', applyInterfaceDensity);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to.');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
