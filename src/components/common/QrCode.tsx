import React, { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** QR code as one SVG path (crisp at any size); the white card around it is the quiet zone */
export const QrCode: React.FC<{ text: string; size: number }> = ({ text, size }) => {
  const { d, count } = useMemo(() => {
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
    return { d: path, count: n };
  }, [text]);

  return (
    <svg className="tg-login-qr" viewBox={`0 0 ${count} ${count}`} width={size} height={size} shapeRendering="crispEdges">
      <path d={d} fill="#000" />
    </svg>
  );
};
