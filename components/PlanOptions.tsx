/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import Spinner from './Spinner';

interface PlanOptionsProps {
  options: Record<string, { url: string | null; description: string }>;
  onSelect: (imageUrl: string) => void;
  isLoading: boolean;
}

const PlanOptions: React.FC<PlanOptionsProps> = ({ options, onSelect, isLoading }) => {
    const optionEntries = Object.entries(options);
    
    return (
        <div className="w-full max-w-7xl mx-auto flex flex-col items-center gap-6 animate-fade-in">
            <div className='text-center'>
                <h2 className="text-3xl font-bold text-gray-100">Select an Initial Concept</h2>
                <p className="text-gray-400 mt-2 max-w-2xl">The AI has generated four site plan concepts based on different road network types. Choose one to refine further.</p>
            </div>

            {isLoading && !optionEntries.some(o => o[1].url) && (
                 <div className="flex flex-col items-center justify-center gap-4 text-center p-8">
                    <Spinner />
                    <p className="text-gray-400">Generating initial concepts...</p>
                </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mt-4">
                {optionEntries.map(([name, { url, description }]) => (
                    <div key={name} className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex flex-col gap-3 backdrop-blur-sm">
                        <h3 className="text-xl font-bold text-center text-blue-300">{name} Network</h3>
                        <div className="aspect-video bg-black/20 rounded-md flex items-center justify-center overflow-hidden">
                            {url ? (
                                <img src={url} alt={`${name} Network Plan`} className="w-full h-full object-cover" />
                            ) : (
                                <Spinner />
                            )}
                        </div>
                        <p className="text-sm text-gray-400 text-center flex-grow">{description}</p>
                        <button
                            onClick={() => url && onSelect(url)}
                            disabled={!url}
                            className="w-full mt-2 bg-gradient-to-br from-blue-600 to-blue-500 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 ease-in-out shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/40 hover:-translate-y-px active:scale-95 disabled:from-gray-600 disabled:shadow-none disabled:cursor-not-allowed"
                        >
                            Select Plan
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};
export default PlanOptions;
