/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from 'react';
import { SiteDatapoints } from '../types';
import DatapointsForm from './DatapointsForm';
import { MagicWandIcon, SearchIcon, LightBulbIcon, PencilIcon } from './icons';
import Spinner from './Spinner';
import SuggestionChips from './SuggestionChips';

interface PlanRefinerProps {
  initialDatapoints: SiteDatapoints;
  onDatapointsChange: (data: SiteDatapoints) => void;
  onRefine: (query: string, datapoints: SiteDatapoints) => void;
  onAnalyze: () => void;
  onStartEdit: () => void;
  isLoading: boolean;
  suggestions: string[];
  isSuggestionsLoading: boolean;
}

const PlanRefiner: React.FC<PlanRefinerProps> = ({ initialDatapoints, onDatapointsChange, onRefine, onAnalyze, onStartEdit, isLoading, suggestions, isSuggestionsLoading }) => {
    const [query, setQuery] = useState('');
    
    const handleRefineClick = () => {
        if (!query.trim()) {
            alert('Please describe the changes you want to make.');
            return;
        }
        onRefine(query, initialDatapoints);
        setQuery(''); // Clear query after submitting
    };

    return (
        <div className="flex flex-col h-full gap-4">
            <h2 className="text-xl font-bold text-center text-gray-200">Refine Your Site Plan</h2>
            <div className="flex-grow overflow-y-auto pr-2 space-y-4">
                
                 <div className="space-y-2">
                    <div className="flex items-start gap-2">
                        <div className="w-7 h-7 mt-1 flex-shrink-0 bg-blue-500/20 rounded-full flex items-center justify-center">
                            <LightBulbIcon className="w-4 h-4 text-blue-300" />
                        </div>
                        <div className="rounded-lg px-3 py-2 bg-gray-700/30">
                            <p className="text-sm text-gray-300">How would you like to refine the plan? Try a suggestion or write your own request below.</p>
                        </div>
                    </div>
                    <div className="pl-9">
                        <SuggestionChips
                            suggestions={suggestions}
                            onSelect={setQuery}
                            isLoading={isSuggestionsLoading}
                            isDisabled={isLoading}
                        />
                    </div>
                </div>

                <div>
                    <label htmlFor="refine-query" className="block text-sm font-medium text-gray-300 mb-1 sr-only">Describe a change:</label>
                    <textarea
                        id="refine-query"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="e.g., 'Add a small park in the center.' or 'Make the lots on the west side larger.'"
                        className="w-full bg-gray-900/50 border border-gray-600 text-gray-200 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:outline-none transition disabled:opacity-60 text-base"
                        disabled={isLoading}
                        rows={3}
                    />
                </div>
                
                <DatapointsForm
                    initialData={initialDatapoints}
                    onDataChange={onDatapointsChange}
                />
            </div>
            
            <div className="flex flex-col gap-3 pt-2">
                <button
                    onClick={handleRefineClick}
                    disabled={isLoading || !query.trim()}
                    className="w-full flex items-center justify-center gap-2 bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <MagicWandIcon className="w-5 h-5" />
                    Refine with Text
                </button>
                 <button
                    onClick={onStartEdit}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <PencilIcon className="w-5 h-5" />
                    Edit on Canvas
                </button>
                <button
                    onClick={onAnalyze}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white font-bold py-3 px-4 rounded-md transition-colors hover:bg-purple-500 disabled:opacity-50"
                >
                    <SearchIcon className="w-5 h-5" />
                    Finalize & Analyze Site Plan
                </button>
            </div>
        </div>
    );
};
export default PlanRefiner;