// src/components/MapView.jsx
import React from 'react';
import { MapPin } from 'lucide-react';

const MapView = ({ spots, routeTo }) => {
  return (
    <div className="relative w-full h-full bg-slate-100 overflow-hidden">
      {/* Mock Map Background Pattern */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />

      {/* Mock Streets */}
      <div className="absolute top-1/4 left-0 right-0 h-4 bg-white border-y border-gray-300 transform -rotate-3" />
      <div className="absolute top-2/3 left-0 right-0 h-6 bg-white border-y border-gray-300 transform rotate-6" />
      <div className="absolute top-0 bottom-0 left-1/3 w-4 bg-white border-x border-gray-300" />
      <div className="absolute top-0 bottom-0 right-1/3 w-5 bg-white border-x border-gray-300 transform -rotate-12" />

      {/* Navigation Route Line */}
      {routeTo && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
          <defs>
            <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f97316" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0.8" />
            </linearGradient>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="0"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#22c55e" />
            </marker>
          </defs>
          <path
            d={`M ${50}% ${50}% Q ${50}% ${routeTo.y}%, ${routeTo.x}% ${routeTo.y}%`}
            stroke="#22c55e"
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            strokeDasharray="10, 5"
            className="animate-pulse"
            markerEnd="url(#arrowhead)"
          />
          <circle cx={`${routeTo.x}%`} cy={`${routeTo.y}%`} r="4" fill="#22c55e" />
        </svg>
      )}

      {/* User Location Marker (Center of Screen) */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10">
        <div className="w-4 h-4 bg-orange-500 rounded-full border-2 border-white shadow-lg animate-pulse" />
        <div className="w-16 h-16 bg-orange-500 rounded-full opacity-10 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-ping" />
      </div>

      {/* Target Parking Spot Pins */}
      {spots.map((spot) => (
        <div
          key={spot.id}
          className="absolute transform -translate-x-1/2 -translate-y-1/2 z-20"
          style={{ top: `${spot.y}%`, left: `${spot.x}%` }}
        >
          <div className="relative flex flex-col items-center">
            <div className="bg-white px-2 py-1 rounded-md shadow-md mb-1 whitespace-nowrap font-bold text-xs">
              {spot.time} min
            </div>
            <MapPin size={48} className="text-red-500 drop-shadow-xl fill-current" />
            <div className="w-2 h-2 bg-black/20 rounded-full blur-sm mt-[-4px]" />
          </div>
        </div>
      ))}
    </div>
  );
};

export default MapView;
