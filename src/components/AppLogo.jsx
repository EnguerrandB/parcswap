// src/components/AppLogo.jsx
import React from 'react';
import logo from '../assets/app-logo.svg';

const AppLogo = ({ size = 40, className = '' }) => (
  <div
    className={`relative rounded-full overflow-visible flex items-center justify-center ${className}`}
    style={{ width: size, height: size }}
  >
    <div
      className="absolute inset-0 rounded-full bg-white/60 blur-md scale-140"
      aria-hidden="true"
    />
    <div className="relative rounded-full bg-white shadow-md overflow-hidden flex items-center justify-center">
      <img src={logo} alt="ParkSwap logo" className="w-full h-full object-contain" />
    </div>
  </div>
);

export default AppLogo;
