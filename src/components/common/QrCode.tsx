import React, { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * QR code rendered as an image with Data URL for 100% compatibility across all Tizen versions
 * (including Chromium 47-69 on older TV chipsets where SVG path rendering can fail).
 */
export const QrCode: React.FC<{ text: string; size: number }> = ({ text, size }) => {
  const { dataUrl, d, count } = useMemo(() => {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      let path = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
        }
      }
      let url = '';
      try {
        url = qr.createDataURL(8, 2);
      } catch (e) {
        url = '';
      }
      return { dataUrl: url, d: path, count: n };
    } catch (e) {
      return { dataUrl: '', d: '', count: 0 };
    }
  }, [text]);

  if (dataUrl) {
    return (
      <img
        src={dataUrl}
        alt="Codigo QR para iniciar sesion"
        className="tg-login-qr"
        width={size}
        height={size}
        style={{
          display: 'block',
          width: `${size}px`,
          height: `${size}px`,
          imageRendering: 'pixelated',
          objectFit: 'contain'
        }}
      />
    );
  }

  if (d && count > 0) {
    return (
      <svg className="tg-login-qr" viewBox={`0 0 ${count} ${count}`} width={size} height={size} shapeRendering="crispEdges">
        <path d={d} fill="#000" />
      </svg>
    );
  }

  return null;
};
