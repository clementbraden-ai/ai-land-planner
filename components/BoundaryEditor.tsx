/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useEffect, useState } from 'react';
import { dataURLtoFile } from '../App';
import { PencilIcon, UploadIcon, LineIcon, EyeIcon, UndoIcon, RedoIcon, LightBulbIcon } from './icons';
import Spinner from './Spinner';

interface BoundaryEditorProps {
  surveyImageUrl: string;
  boundaryImageUrl: string;
  onRefine: (maskFile: File, query: string) => Promise<void>;
  onBack: () => void;
  suggestions: string[];
  isSuggestionsLoading: boolean;
}

type Point = { x: number; y: number };
type Tool = 'pencil' | 'line';

const LayerToggle: React.FC<{ label: string; checked: boolean; onChange: () => void; disabled: boolean; }> = ({ label, checked, onChange, disabled }) => (
    <label className={`flex items-center gap-2 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <div className="relative">
            <input type="checkbox" className="sr-only peer" checked={checked} onChange={onChange} disabled={disabled} />
            <div className="w-10 h-6 bg-gray-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </div>
        <span className="text-sm font-medium text-gray-300">{label}</span>
    </label>
);


const BoundaryEditor: React.FC<BoundaryEditorProps> = ({ surveyImageUrl, boundaryImageUrl, onRefine, onBack, suggestions, isSuggestionsLoading }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const hasDrawn = useRef(false);
  const lastPos = useRef<Point | null>(null);
  const lineStartPos = useRef<Point | null>(null);
  const canvasSnapshot = useRef<ImageData | null>(null);
  const [query, setQuery] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  
  // Drawing tool state
  const [tool, setTool] = useState<Tool>('pencil');
  const [brushSize, setBrushSize] = useState(15);
  const [opacity, setOpacity] = useState(1.0);
  
  // Layer visibility state
  const [layers, setLayers] = useState({
    survey: true,
    boundary: true,
    drawing: true,
  });

  // History state
  const history = useRef<ImageData[]>([]);
  const historyIndex = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const handleLayerToggle = (layer: keyof typeof layers) => {
    setLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  const updateUndoRedoState = () => {
      setCanUndo(historyIndex.current > 0);
      setCanRedo(historyIndex.current < history.current.length - 1);
  };

  const saveState = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      
      const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const newHistory = history.current.slice(0, historyIndex.current + 1);
      newHistory.push(currentState);

      history.current = newHistory;
      historyIndex.current = newHistory.length - 1;
      updateUndoRedoState();
  };

  const restoreState = (state: ImageData) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
          ctx.putImageData(state, 0, 0);
      }
  };

  const handleUndo = () => {
      if (!canUndo) return;
      historyIndex.current--;
      restoreState(history.current[historyIndex.current]);
      updateUndoRedoState();
  };

  const handleRedo = () => {
      if (!canRedo) return;
      historyIndex.current++;
      restoreState(history.current[historyIndex.current]);
      updateUndoRedoState();
  };


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
      // Initialize history
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const initialState = ctx.getImageData(0, 0, canvas.width, canvas.height);
      history.current = [initialState];
      historyIndex.current = 0;
      updateUndoRedoState();
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
        ctx.strokeStyle = `rgba(255, 0, 255, ${opacity})`; // Magenta with opacity
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    };

    const startDrawing = (e: MouseEvent) => {
      hasDrawn.current = false;
      const pos = getMousePos(e);
      setupContext();
      if (tool === 'pencil') {
          isDrawing.current = true;
          lastPos.current = pos;
      } else if (tool === 'line') {
          lineStartPos.current = pos;
          canvasSnapshot.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    };

    const draw = (e: MouseEvent) => {
      if (isDrawing.current || lineStartPos.current) {
          hasDrawn.current = true;
      }
      const pos = getMousePos(e);
      if (tool === 'pencil') {
        if (!isDrawing.current || !lastPos.current) return;
        ctx.beginPath();
        ctx.moveTo(lastPos.current.x, lastPos.current.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        lastPos.current = pos;
      } else if (tool === 'line') {
        if (!lineStartPos.current || !canvasSnapshot.current) return;
        // Restore snapshot and draw preview line
        ctx.putImageData(canvasSnapshot.current, 0, 0);
        ctx.beginPath();
        ctx.moveTo(lineStartPos.current.x, lineStartPos.current.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }
    };

    const stopDrawing = (e: MouseEvent) => {
      if (tool === 'pencil') {
        isDrawing.current = false;
        lastPos.current = null;
      } else if (tool === 'line') {
        if (!lineStartPos.current || !canvasSnapshot.current) return;
        const pos = getMousePos(e);
        // Restore and draw final line
        ctx.putImageData(canvasSnapshot.current, 0, 0);
        ctx.beginPath();
        ctx.moveTo(lineStartPos.current.x, lineStartPos.current.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        lineStartPos.current = null;
        canvasSnapshot.current = null;
      }

      if (hasDrawn.current) {
          saveState();
      }
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
  }, [surveyImageUrl, tool, brushSize, opacity]);

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        saveState();
      }
    }
  };

  const handleUpdate = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !query.trim()) {
      alert("Please draw on the image and describe your changes.");
      return;
    }
    const maskDataUrl = canvas.toDataURL('image/png');
    const maskFile = dataURLtoFile(maskDataUrl, 'mask.png');
    
    setIsUpdating(true);
    try {
        await onRefine(maskFile, query);
        // On success, the component will unmount as the app stage changes.
        // No need to clear state here.
    } catch (error) {
        // On failure, the error is handled in the parent component.
        // We stop the loading indicator here so the user can try again.
        console.error("Refinement failed, user can retry.", error);
        setIsUpdating(false);
    }
  };
  
  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 animate-fade-in">
        <div className='text-center'>
            <h2 className="text-3xl font-bold text-gray-100">Refine Site Boundary</h2>
            <p className="text-gray-400 mt-2">Use the tools to highlight areas on the survey that need correction, then describe the changes below.</p>
        </div>

        {/* --- Drawing & Layer Toolbar --- */}
        <div className="w-full bg-gray-900/60 border border-gray-700 rounded-lg p-3 flex flex-col gap-3 backdrop-blur-sm">
            <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center sm:justify-between gap-4">
                 <div className='flex items-center gap-2'>
                    <span className='text-sm font-semibold text-gray-400'>Tool:</span>
                    <button onClick={() => setTool('pencil')} disabled={isUpdating} className={`p-2 rounded-md transition-colors ${tool === 'pencil' ? 'bg-blue-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}><PencilIcon className='w-5 h-5'/></button>
                    <button onClick={() => setTool('line')} disabled={isUpdating} className={`p-2 rounded-md transition-colors ${tool === 'line' ? 'bg-blue-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}><LineIcon className='w-5 h-5'/></button>
                </div>
                 <div className='flex items-center gap-2'>
                    <span className='text-sm font-semibold text-gray-400'>Size:</span>
                    <input type="range" min="2" max="50" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} disabled={isUpdating} className="w-24 cursor-pointer" />
                    <span className='text-xs text-gray-300 w-6 text-right'>{brushSize}px</span>
                </div>
                 <div className='flex items-center gap-2'>
                    <span className='text-sm font-semibold text-gray-400'>Opacity:</span>
                    <input type="range" min="0.1" max="1.0" step="0.1" value={opacity} onChange={e => setOpacity(Number(e.target.value))} disabled={isUpdating} className="w-24 cursor-pointer" />
                    <span className='text-xs text-gray-300 w-8 text-right'>{Math.round(opacity * 100)}%</span>
                </div>
                <div className='flex items-center gap-2'>
                    <button onClick={handleUndo} disabled={!canUndo || isUpdating} className={`p-2 rounded-md transition-colors bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed`} title="Undo"><UndoIcon className='w-5 h-5'/></button>
                    <button onClick={handleRedo} disabled={!canRedo || isUpdating} className={`p-2 rounded-md transition-colors bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed`} title="Redo"><RedoIcon className='w-5 h-5'/></button>
                </div>
            </div>
             <div className="border-t border-gray-700 -mx-3 my-1"></div>
             <div className="flex items-center justify-center gap-6">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-400">
                    <EyeIcon className='w-5 h-5' />
                    <span>Layers:</span>
                </div>
                <LayerToggle label="Survey" checked={layers.survey} onChange={() => handleLayerToggle('survey')} disabled={isUpdating} />
                <LayerToggle label="Boundary" checked={layers.boundary} onChange={() => handleLayerToggle('boundary')} disabled={isUpdating} />
                <LayerToggle label="Drawing" checked={layers.drawing} onChange={() => handleLayerToggle('drawing')} disabled={isUpdating} />
             </div>
        </div>

        <div className="relative border-2 border-dashed border-gray-600 rounded-lg overflow-hidden bg-gray-900">
             {isUpdating && (
                <div className="absolute inset-0 bg-black/70 z-20 flex flex-col items-center justify-center gap-4 animate-fade-in backdrop-blur-sm">
                    <Spinner />
                    <p className="text-gray-300">Updating boundary...</p>
                </div>
            )}
            <img src={surveyImageUrl} alt="Site Survey" className={`w-full h-auto object-contain transition-opacity duration-300 ${layers.survey ? 'opacity-100' : 'opacity-0'}`} />
            <img src={boundaryImageUrl} alt="Current Site Boundary" className={`absolute top-0 left-0 w-full h-full object-contain pointer-events-none transition-opacity duration-300 ${layers.boundary ? 'opacity-100' : 'opacity-0'}`} />
            <canvas ref={canvasRef} className={`absolute top-0 left-0 w-full h-full cursor-crosshair z-10 transition-opacity duration-300 ${layers.drawing ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
        </div>
        
        <div className="space-y-2">
            <div className="flex items-start gap-2">
                <div className="w-7 h-7 mt-1 flex-shrink-0 bg-blue-500/20 rounded-full flex items-center justify-center">
                    <LightBulbIcon className="w-4 h-4 text-blue-300" />
                </div>
                <div className="rounded-lg px-3 py-2 bg-gray-700/30">
                    <p className="text-sm text-gray-300">Need an idea? Try an AI-generated suggestion to refine your boundary.</p>
                </div>
            </div>
             <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pl-9">
                {isSuggestionsLoading ? (
                    <div className="col-span-3 flex items-center justify-center p-2">
                        <Spinner className="w-5 h-5" />
                        <span className="ml-2 text-sm text-gray-400">Generating suggestions...</span>
                    </div>
                ) : (
                    (suggestions.length > 0 ? suggestions : Array(3).fill(''))
                    .map((suggestion, index) => (
                        <button 
                            key={index} 
                            onClick={() => suggestion && setQuery(suggestion)}
                            disabled={isUpdating || !suggestion}
                            className="text-left text-xs bg-white/5 text-gray-300 font-medium py-2 px-3 rounded-md transition-colors hover:bg-white/10 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed h-12"
                        >
                            {suggestion || <span className="text-gray-500">No suggestion available.</span>}
                        </button>
                    ))
                )}
            </div>
        </div>

        <div className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex flex-col gap-4 backdrop-blur-sm">
             <div className='flex items-center gap-2'>
                <PencilIcon className='w-6 h-6 text-blue-400 flex-shrink-0' />
                <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g., 'The red line is missing the curved section on the left.' or 'Include the pond area within the boundary.'"
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
                    Back
                 </button>
                <button
                    onClick={handleUpdate}
                    disabled={isUpdating || !query.trim()}
                    className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-br from-blue-600 to-blue-500 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 ease-in-out shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/40 hover:-translate-y-px active:scale-95 disabled:from-blue-800 disabled:cursor-not-allowed"
                >
                   {isUpdating ? <Spinner className='w-5 h-5' /> : <UploadIcon className='w-5 h-5'/>}
                   {isUpdating ? 'Updating...' : 'Update Boundary'}
                </button>
             </div>
        </div>
    </div>
  );
};

export default BoundaryEditor;