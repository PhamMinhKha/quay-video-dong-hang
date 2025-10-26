import React, { useRef, useEffect } from 'react';

interface QRDetectorProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  onDetect: (result: any) => void;
}

const QRDetector: React.FC<QRDetectorProps> = ({ videoRef, onDetect }) => {
  // Component này được sử dụng để phát hiện QR code
  // Logic đã được tích hợp vào CameraView
  return null;
};

export default QRDetector;

