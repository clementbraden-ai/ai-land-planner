/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useEffect, useState } from 'react';
import { dataURLtoFile } from '../App';
import { PencilIcon, UploadIcon } from './icons';

interface BoundaryEditorProps {
  surveyImageUrl: string;
  boundaryImageUrl: string;
  onRefine: (maskFile: File, query: string) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}

const BoundaryEditor: React.FC<BoundaryEditorProps> = ({ surveyImageUrl, boundaryImageUrl, onRefine, onCancel, isLoading }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number, y: number } | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = surveyImageUrl;
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
    };

    const getMousePos = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const startDrawing = (e: MouseEvent) => {
      isDrawing.current = true;
      lastPos.current = getMousePos(e);
    };

    const draw = (e: MouseEvent) => {
      if (!isDrawing.current || !lastPos.current) return;
      const pos = getMousePos(e);
      ctx.beginPath();
      ctx.strokeStyle = '#ff00ff'; // Use a bright color for the mask
      ctx.lineWidth = 15;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      lastPos.current = pos;
    };

    const stopDrawing = () => {
      isDrawing.current = false;
      lastPos.current = null;
    };

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    return () => {
      canvas.removeEventListener('mousedown', startDrawing);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', stopDrawing);
      canvas.removeEventListener('mouseleave', stopDrawing);
    };
  }, [surveyImageUrl]);

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const handleUpdate = () => {
    const canvas = canvasRef.current;
    if (!canvas || !query.trim()) {
      alert("Please draw on the image and describe your changes.");
      return;
    }
    const maskDataUrl = canvas.toDataURL('image/png');
    const maskFile = dataURLtoFile(maskDataUrl, 'mask.png');
    
    // Trigger the async refinement process
    onRefine(maskFile, query);
    
    // Immediately clear the inputs for instant user feedback
    handleClear();
    setQuery('');
  };
  
  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 animate-fade-in">
        <div className='text-center'>
            <h2 className="text-3xl font-bold text-gray-100">Refine Site Boundary</h2>
            <p className="text-gray-400 mt-2">Use the pencil to highlight areas on the survey that need correction, then describe the changes below.</p>
        </div>

        <div className="relative border-2 border-dashed border-gray-600 rounded-lg overflow-hidden">
            <img src={surveyImageUrl} alt="Site Survey" className="w-full h-auto object-contain" />
            <img src={boundaryImageUrl} alt="Detected Site Boundary" className="absolute top-0 left-0 w-full h-full object-contain opacity-50 pointer-events-none" />
            <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full cursor-crosshair" />
        </div>

        <div className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex flex-col gap-4 backdrop-blur-sm">
             <div className='flex items-center gap-2'>
                <PencilIcon className='w-6 h-6 text-blue-400 flex-shrink-0' />
                <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g., 'The red line is missing the curved section on the left.' or 'Include the pond area within the boundary.'"
                    className="flex-grow bg-gray-800 border border-gray-600 text-gray-200 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:outline-none transition w-full disabled:cursor-not-allowed disabled:opacity-60 text-base"
                    disabled={isLoading}
                    rows={3}
                />
            </div>
             <div className="flex flex-col sm:flex-row gap-4 mt-2">
                 <button 
                    onClick={handleClear} 
                    disabled={isLoading}
                    className="flex-1 bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20 disabled:opacity-50"
                 >
                    Clear Drawing
                 </button>
                 <button 
                    onClick={onCancel}
                    disabled={isLoading}
                    className="flex-1 bg-red-600/80 text-white font-semibold py-3 px-4 rounded-md transition-colors hover:bg-red-500 disabled:opacity-50"
                 >
                    Cancel
                 </button>
                <button
                    onClick={handleUpdate}
                    disabled={isLoading || !query.trim()}
                    className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-br from-blue-600 to-blue-500 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 ease-in-out shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/40 hover:-translate-y-px active:scale-95 disabled:from-blue-800 disabled:cursor-not-allowed"
                >
                   <UploadIcon className='w-5 h-5'/>
                   Update Boundary
                </button>
             </div>
        </div>
    </div>
  );
};

export default BoundaryEditor;