/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from 'react';
import Spinner from './Spinner';
import { UndoIcon } from './icons';

interface PlanOptionsProps {
  onGenerate: (networkType: string) => Promise<string>;
  onSelect: (imageUrl: string) => void;
  onBack: () => void;
}

const networkTypes = [
    { name: 'Grid', description: 'A classic criss-cross pattern, efficient and easy to navigate.' },
    { name: 'Organic', description: 'A flowing, curvilinear layout that follows natural contours, creating a scenic feel.' },
    { name: 'Cul-de-sac', description: 'Prioritizes dead-end streets to maximize privacy and safety by eliminating through-traffic.' },
    { name: 'Hierarchical', description: 'A mix of major arterial roads and smaller local streets for efficient traffic flow.' },
    { name: 'Radial', description: 'Roads spread out from a central point, often creating a focal point.' },
    { name: 'Circular', description: 'Features roads that form loops or circles, good for traffic calming.' },
];

const PlanOptions: React.FC<PlanOptionsProps> = ({ onGenerate, onSelect, onBack }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [previews, setPreviews] = useState<Record<string, string>>({});

    const currentNetwork = networkTypes[currentIndex];

    const handleNavigate = (direction: 'prev' | 'next') => {
        const newIndex = direction === 'prev'
            ? (currentIndex - 1 + networkTypes.length) % networkTypes.length
            : (currentIndex + 1) % networkTypes.length;
        
        setCurrentIndex(newIndex);
        
        const newNetworkName = networkTypes[newIndex].name;
        setPreviewUrl(previews[newNetworkName] || null);
        setError(null);
    };

    const handleGenerate = async () => {
        setIsGenerating(true);
        setPreviewUrl(null);
        setError(null);
        try {
            const url = await onGenerate(currentNetwork.name);
            setPreviewUrl(url);
            setPreviews(prev => ({ ...prev, [currentNetwork.name]: url }));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
            setError(`Failed to generate preview: ${errorMessage}`);
        } finally {
            setIsGenerating(false);
        }
    };
    
    return (
        <div className="w-full max-w-4xl mx-auto flex flex-col items-center gap-6 animate-fade-in">
            <div className='text-center relative w-full'>
                <button
                    onClick={onBack}
                    className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-2 text-gray-300 hover:text-white transition-colors group"
                    aria-label="Go back"
                    disabled={isGenerating}
                >
                    <UndoIcon className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
                    <span className="hidden sm:inline">Back</span>
                </button>
                <h2 className="text-3xl font-bold text-gray-100">Generate a Concept Plan</h2>
                <p className="text-gray-400 mt-2 max-w-2xl mx-auto">Select a road network type, generate a preview, and then select the concept you'd like to refine.</p>
            </div>

            <div className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-6 flex flex-col gap-4 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                     <button onClick={() => handleNavigate('prev')} disabled={isGenerating} className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50 text-2xl font-bold leading-none flex items-center justify-center w-12 h-12">&lt;</button>
                     <div className="text-center">
                        <h3 className="text-2xl font-bold text-blue-300">{currentNetwork.name} Network</h3>
                        <p className="text-sm text-gray-400 mt-1">{currentNetwork.description}</p>
                     </div>
                     <button onClick={() => handleNavigate('next')} disabled={isGenerating} className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50 text-2xl font-bold leading-none flex items-center justify-center w-12 h-12">&gt;</button>
                </div>
                
                <div className="aspect-video bg-black/20 rounded-md flex flex-col items-center justify-center overflow-hidden relative">
                    {isGenerating && (
                         <div className="flex flex-col items-center justify-center gap-4 text-center p-8">
                            <Spinner />
                            <p className="text-gray-400">Generating preview...</p>
                        </div>
                    )}
                    {error && !isGenerating && (
                         <div className="text-center text-red-400 p-4">
                            <p className="font-semibold">Error</p>
                            <p className="text-sm">{error}</p>
                         </div>
                    )}
                    {previewUrl && !isGenerating && (
                        <img src={previewUrl} alt={`${currentNetwork.name} Network Plan Preview`} className="w-full h-full object-contain" />
                    )}
                    {!previewUrl && !isGenerating && !error && (
                        <div className="text-center text-gray-500">
                            <p>Click "Generate Preview" to see the concept</p>
                        </div>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row gap-4 mt-2">
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="flex-1 bg-white/10 text-gray-200 font-bold py-3 px-6 rounded-lg transition-colors hover:bg-white/20 disabled:opacity-50"
                    >
                       Generate Preview
                    </button>
                    <button
                        onClick={() => previewUrl && onSelect(previewUrl)}
                        disabled={!previewUrl || isGenerating}
                        className="flex-1 bg-gradient-to-br from-blue-600 to-blue-500 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 ease-in-out shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/40 hover:-translate-y-px active:scale-95 disabled:from-gray-600 disabled:shadow-none disabled:cursor-not-allowed"
                    >
                        Select This Plan
                    </button>
                </div>
            </div>
        </div>
    );
};
export default PlanOptions;