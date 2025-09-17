/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import Spinner from './Spinner';

interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  isLoading: boolean;
  isDisabled: boolean;
}

const SuggestionChips: React.FC<SuggestionChipsProps> = ({ suggestions, onSelect, isLoading, isDisabled }) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-2">
        <Spinner className="w-5 h-5" />
        <span className="ml-2 text-sm text-gray-400">Generating suggestions...</span>
      </div>
    );
  }

  if (suggestions.length === 0) {
      return (
          <div className="text-center p-2">
              <p className="text-sm text-gray-500">No suggestions available at the moment.</p>
          </div>
      );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          onClick={() => onSelect(suggestion)}
          disabled={isDisabled || !suggestion}
          className="text-left text-sm bg-white/5 text-gray-300 font-medium py-2 px-3 rounded-lg transition-colors hover:bg-white/10 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
};

export default SuggestionChips;
