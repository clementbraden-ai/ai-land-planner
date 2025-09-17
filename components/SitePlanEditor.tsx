/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useEffect, useState } from 'react';
import { dataURLtoFile } from '../App';
import { PencilIcon, CheckIcon } from './icons';
import Spinner from './Spinner';

interface SitePlanEditorProps {
  sitePlanImageUrl: string;
  onRefine: (maskFile: File, query: string) => Promise<void>;
  onBack: () => void;
}

type Point = { x: number; y: number };

const SitePlanEditor: React.FC<SitePlanEditorProps> = ({ sitePlanImageUrl, onRefine, onBack }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<Point | null>(null);
  const [query, setQuery] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [brushSize] = useState(20);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = sitePlanImageUrl;
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    const getMousePos = (e: MouseEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };
    
    const setupContext = () => {
        ctx.strokeStyle = `rgba(255, 0, 255, 0.7)`; // Semi-transparent Magenta
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    };

    const startDrawing = (e: MouseEvent) => {
      isDrawing.current = true;
      lastPos.current = getMousePos(e);
      setupContext();
    };

    const draw = (e: MouseEvent) => {
      if (!isDrawing.current || !lastPos.current) return;
      const pos = getMousePos(e);
      ctx.beginPath();
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
  }, [sitePlanImageUrl, brushSize]);

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const handleApply = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !query.trim()) {
      alert("Please draw on the plan and describe your changes.");
      return;
    }
    const maskDataUrl = canvas.toDataURL('image/png');
    const maskFile = dataURLtoFile(maskDataUrl, 'mask.png');
    
    setIsUpdating(true);
    try {
        await onRefine(maskFile, query);
    } catch (error) {
        console.error("Visual refinement failed, user can retry.", error);
        setIsUpdating(false);
    }
  };
  
  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 animate-fade-in">
        <div className='text-center'>
            <h2 className="text-3xl font-bold text-gray-100">Edit Site Plan</h2>
            <p className="text-gray-400 mt-2">Draw on the plan to indicate where changes are needed, then describe your desired edits below.</p>
        </div>

        <div className="relative border-2 border-dashed border-gray-600 rounded-lg overflow-hidden bg-gray-900">
             {isUpdating && (
                <div className="absolute inset-0 bg-black/70 z-20 flex flex-col items-center justify-center gap-4 animate-fade-in backdrop-blur-sm">
                    <Spinner />
                    <p className="text-gray-300">Applying edits...</p>
                </div>
            )}
            <img src={sitePlanImageUrl} alt="Site Plan" className="w-full h-auto object-contain" />
            <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full cursor-crosshair z-10" />
        </div>
        
        <div className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex flex-col gap-4 backdrop-blur-sm">
             <div className='flex items-center gap-3'>
                <PencilIcon className='w-6 h-6 text-blue-400 flex-shrink-0' />
                <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g., 'Connect these two roads' or 'Replace this area with a park.'"
                    className="flex-grow bg-gray-800 border border-gray-600 text-gray-200 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:outline-none transition w-full disabled:cursor-not-allowed disabled:opacity-60 text-base"
                    disabled={isUpdating}
                    rows={3}
                />
            </div>
             <div className="flex flex-col sm:flex-row gap-4 mt-2">
                 <button 
                    onClick={handleClear} 
                    disabled={isUpdating}
                    className="flex-1 bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20 disabled:opacity-50"
                 >
                    Clear Drawing
                 </button>
                 <button 
                    onClick={onBack}
                    disabled={isUpdating}
                    className="flex-1 bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20 disabled:opacity-50"
                 >
                    Back to Refinement
                 </button>
                <button
                    onClick={handleApply}
                    disabled={isUpdating || !query.trim()}
                    className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-br from-blue-600 to-blue-500 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 ease-in-out shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/40 hover:-translate-y-px active:scale-95 disabled:from-blue-800 disabled:cursor-not-allowed"
                >
                   {isUpdating ? <Spinner className='w-5 h-5' /> : <CheckIcon className='w-5 h-5'/>}
                   {isUpdating ? 'Applying...' : 'Apply Edits'}
                </button>
             </div>
        </div>
    </div>
  );
};

export default SitePlanEditor;
