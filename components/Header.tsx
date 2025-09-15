/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React from 'react';
import { BullseyeIcon, UndoIcon } from './icons';

interface HeaderProps {
    onBack: () => void;
    appStage: string;
}

const Header: React.FC<HeaderProps> = ({ onBack, appStage }) => {
  const showBackButton = appStage !== 'UPLOAD';

  return (
    <header className="w-full py-4 px-8 border-b border-gray-700 bg-gray-800/30 backdrop-blur-sm sticky top-0 z-50">
      <div className="flex items-center justify-center relative max-w-7xl mx-auto">
          {showBackButton && (
              <button
                onClick={onBack}
                className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-2 text-gray-300 hover:text-white transition-colors group"
                aria-label="Go back"
              >
                <UndoIcon className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
                <span className="hidden sm:inline">Back</span>
              </button>
          )}
          <div className="flex items-center justify-center gap-3">
              <BullseyeIcon className="w-6 h-6 text-blue-400" />
              <h1 className="text-xl font-bold tracking-tight text-gray-100">
                Smart Land Planner
              </h1>
          </div>
      </div>
    </header>
  );
};

export default Header;