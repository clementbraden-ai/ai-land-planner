/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useEffect, useState } from 'react';
import { dataURLtoFile } from '../App';
import { CheckIcon } from './icons';

interface AccessPointEditorProps {
  surveyImageUrl: string;
  boundaryImageUrl: string;
  onConfirm: (accessPointsFile: File) => void;
  onBack: () => void;
  isLoading: boolean;
}

type Point = { x: number, y: number };

const AccessPointEditor: React.FC<AccessPointEditorProps> = ({ surveyImageUrl, boundaryImageUrl, onConfirm, onBack, isLoading }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<Point[]>([]);

  // Effect to set canvas size based on the survey image
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = surveyImageUrl;
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
    };
  }, [surveyImageUrl]);

  // Effect to draw points when the points array changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas before redrawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all points
    points.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 15, 0, 2 * Math.PI); // Radius of 15px
        ctx.fillStyle = 'rgba(59, 130, 246, 0.7)'; // Semi-transparent blue
        ctx.fill();
        ctx.strokeStyle = '#BFDBFE'; // Light blue border
        ctx.lineWidth = 2;
        ctx.stroke();
    });
  }, [points, surveyImageUrl]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const newPoint = {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
    setPoints(prevPoints => [...prevPoints, newPoint]);
  };

  const handleClear = () => {
    setPoints([]);
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const accessPointsDataUrl = canvas.toDataURL('image/png');
    const accessPointsFile = dataURLtoFile(accessPointsDataUrl, 'access-points.png');
    onConfirm(accessPointsFile);
  };
  
  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 animate-fade-in">
        <div className='text-center'>
            <h2 className="text-3xl font-bold text-gray-100">Mark Road Access Points</h2>
            <p className="text-gray-400 mt-2">Click on the site boundary to place blue circles where roads should connect to the site.</p>
        </div>

        <div className="relative border-2 border-dashed border-gray-600 rounded-lg overflow-hidden">
            <img src={surveyImageUrl} alt="Site Survey" className="w-full h-auto object-contain" />
            <img src={boundaryImageUrl} alt="Detected Site Boundary" className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none" />
            <canvas ref={canvasRef} onClick={handleCanvasClick} className="absolute top-0 left-0 w-full h-full cursor-pointer" />
        </div>

        <div className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex flex-col sm:flex-row gap-4 backdrop-blur-sm">
             <button 
                onClick={handleClear} 
                disabled={isLoading}
                className="flex-1 bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20 disabled:opacity-50"
             >
                Clear All Points
             </button>
             <button 
                onClick={onBack}
                disabled={isLoading}
                className="flex-1 bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20 disabled:opacity-50"
             >
                Back
             </button>
            <button
                onClick={handleConfirm}
                disabled={isLoading || points.length === 0}
                className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-br from-blue-600 to-blue-500 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 ease-in-out shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/40 hover:-translate-y-px active:scale-95 disabled:from-blue-800 disabled:cursor-not-allowed"
            >
               <CheckIcon className='w-5 h-5'/>
               Confirm Points & Generate
            </button>
        </div>
    </div>
  );
};

export default AccessPointEditor;