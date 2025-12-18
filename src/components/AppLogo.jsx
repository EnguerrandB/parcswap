// src/components/AppLogo.jsx
import React from 'react';
import logo from '../assets/app-logo.svg';

const AppLogo = ({ size = 40, className = '' }) => (
  <div
    className={`relative rounded-full overflow-visible flex items-center justify-center ${className}`}
    style={{ width: size, height: size }}
  >
    <img src={logo} alt="ParkSwap logo" className="w-full h-full object-contain" />
  </div>
);

export default AppLogo;
