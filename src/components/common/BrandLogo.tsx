import React from 'react';

export interface BrandLogoProps {
  onClick?: () => void;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ onClick, className = '' }) => {
  return (
    <div className={`brand-container ${className}`} onClick={onClick}>
      <img className="brand-logo-img" src="assets/logo_3d.png" alt="XuperTV" />
      <div className="brand-title">
        <span className="tizen">TIZEN</span>
        <span className="xuper">XUPER</span>
        <span className="tv">TV</span>
      </div>
    </div>
  );
};
