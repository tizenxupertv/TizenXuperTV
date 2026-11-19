import React from 'react';

export interface BrandLogoProps {
  onClick?: () => void;
  className?: string;
}

export function getBrandPrefix(): 'MAC' | 'WIN' | 'TIZEN' {
  try {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('desktop');
      if (p === 'mac') return 'MAC';
      if (p === 'win') return 'WIN';
    }
  } catch {}
  return 'TIZEN';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ onClick, className = '' }) => {
  const prefix = getBrandPrefix();
  return (
    <div className={`brand-container ${className}`} onClick={onClick}>
      <img className="brand-logo-img" src="assets/logo_3d.png" alt={`${prefix}Xuper TV`} />
      <div className="brand-title">
        <span className="tizen">{prefix}</span>
        <span className="xuper">XUPER</span>
        <span className="tv">TV</span>
      </div>
    </div>
  );
};
