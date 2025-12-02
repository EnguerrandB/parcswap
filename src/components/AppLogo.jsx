// src/components/AppLogo.jsx
import React from 'react';
import logo from '../assets/app-logo.svg';

const AppLogo = ({ size = 40, className = '' }) => (
  <div
    className={`rounded-full bg-white shadow-md border border-white overflow-hidden flex items-center justify-center logo-pulse ${className}`}
    style={{ width: size, height: size }}
  >
    <img src={logo} alt="ParkSwap logo" className="w-full h-full object-contain" />
  </div>
);

export default AppLogo;
