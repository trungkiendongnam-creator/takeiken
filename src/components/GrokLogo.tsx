import React from 'react';

interface GrokLogoProps {
  className?: string;
}

export const GrokLogo: React.FC<GrokLogoProps> = ({ className = 'w-8 h-8' }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <rect x="6" y="10" width="52" height="44" rx="20" fill="#E6F2ED" />
    <rect x="11" y="15" width="42" height="34" rx="15" fill="#06231F" />
    <rect x="13" y="17" width="38" height="30" rx="13" fill="#E6F2ED" />
    {/* Visor eyes matching Grok Bot mascot */}
    <rect x="22" y="25" width="6" height="14" rx="3" fill="#031713" />
    <rect x="36" y="25" width="6" height="14" rx="3" fill="#031713" />
    {/* Subtle sheen */}
    <path
      d="M18 21C22 18.5 29 18 36 18.5"
      stroke="#FFFFFF"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.7"
    />
  </svg>
);
