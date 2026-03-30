import React from 'react';
import logo from '../assets/app-logo.png';

const AppLogo = ({ size = 40, className = '' }) => (
  <div
    className={`relative rounded-full overflow-visible flex items-center justify-center ${className}`}
    style={{ width: size, height: size }}
    aria-label="LoulouPark logo"
    role="img"
  >
    <img src={logo} alt="LoulouPark logo" className="h-full w-full object-contain" />
  </div>
);

export default AppLogo;
