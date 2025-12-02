// src/components/RoadAnimation.jsx
import React, { useMemo } from 'react';

const RoadAnimation = () => {
  // Smooth S-curve across the full viewBox
  const pathD = useMemo(
    () => 'M 0 10 C 30 30 70 0 100 25 S 70 70 100 90',
    [],
  );

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="carGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#b91c1c" />
        </linearGradient>
        <linearGradient id="glass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#cbd5e1" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.8" />
        </linearGradient>
        <linearGradient id="yellowCar" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>

      <path
        id="roadPath"
        d={pathD}
        fill="none"
        stroke="#0f172a"
        strokeWidth="0.8"
        strokeDasharray="2 3"
        opacity="0.65"
      />

      {/* timing helper for sync */}
      <animate
        id="redLoop"
        attributeName="opacity"
        from="1"
        to="1"
        dur="20s"
        begin="0s;redLoop.end"
        fill="freeze"
      />

      {/* Red car (leads) */}
      <g transform="translate(-3 -1.75)">
        <rect
          width="6"
          height="3.5"
          rx="1"
          fill="url(#carGradient)"
          stroke="#0f172a"
          strokeWidth="0.15"
        >
          <animateMotion id="redMotion" dur="20s" repeatCount="indefinite" rotate="auto" fill="freeze">
            <mpath xlinkHref="#roadPath" />
          </animateMotion>
        </rect>
        <rect
          x="0.8"
          y="0.5"
          width="4.4"
          height="1.8"
          rx="0.4"
          fill="url(#glass)"
          stroke="#94a3b8"
          strokeWidth="0.08"
        >
          <animateMotion dur="20s" repeatCount="indefinite" rotate="auto" fill="freeze">
            <mpath xlinkHref="#roadPath" />
          </animateMotion>
        </rect>
      </g>

      {/* Yellow car waits mid-path then moves */}
      <g transform="translate(-3 -1.75)">
        <rect
          width="6"
          height="3.5"
          rx="1"
          fill="url(#yellowCar)"
          stroke="#92400e"
          strokeWidth="0.15"
        >
          {/* Hold at midpoint */}
          <animateMotion
            dur="0.001s"
            begin="0s"
            fill="freeze"
            keyPoints="0.5;0.5"
            keyTimes="0;1"
            calcMode="linear"
            rotate="auto"
          >
            <mpath xlinkHref="#roadPath" />
          </animateMotion>
          {/* Move once red is behind (start mid-loop) */}
          <animateMotion
            dur="12s"
            begin="redLoop.begin+10s;redLoop.end+10s"
            repeatCount="1"
            fill="freeze"
            keyPoints="0.5;1"
            keyTimes="0;1"
            calcMode="linear"
            rotate="auto"
          >
            <mpath xlinkHref="#roadPath" />
          </animateMotion>
        </rect>
        <rect
          x="0.8"
          y="0.5"
          width="4.4"
          height="1.8"
          rx="0.4"
          fill="url(#glass)"
          stroke="#94a3b8"
          strokeWidth="0.08"
        >
          <animateMotion
            dur="0.001s"
            begin="0s"
            fill="freeze"
            keyPoints="0.5;0.5"
            keyTimes="0;1"
            calcMode="linear"
            rotate="auto"
          >
            <mpath xlinkHref="#roadPath" />
          </animateMotion>
          <animateMotion
            dur="12s"
            begin="redLoop.begin+10s;redLoop.end+10s"
            repeatCount="1"
            fill="freeze"
            keyPoints="0.5;1"
            keyTimes="0;1"
            calcMode="linear"
            rotate="auto"
          >
            <mpath xlinkHref="#roadPath" />
          </animateMotion>
        </rect>
      </g>
    </svg>
  );
};

export default RoadAnimation;
