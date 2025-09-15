/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect } from 'react';
import { SiteDatapoints } from '../types';

interface DatapointsFormProps {
  initialData: SiteDatapoints;
  onDataChange: (data: SiteDatapoints) => void;
}

const FormRow: React.FC<{
    label: string;
    unit: string;
    name: keyof SiteDatapoints;
    value: number;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}> = ({ label, unit, name, value, onChange }) => (
    <div className="flex items-center justify-between gap-2 py-2">
        <label htmlFor={name} className="text-sm text-gray-300 flex-shrink-0">{label}</label>
        <div className="flex items-center gap-2">
            <input 
                type="number" 
                id={name} 
                name={name} 
                value={value} 
                onChange={onChange} 
                className="bg-gray-900/50 border border-gray-600 text-gray-200 rounded-md p-2 w-24 text-right focus:ring-2 focus:ring-blue-500 focus:outline-none transition"
            />
            <span className="text-sm text-gray-400 w-8">{unit}</span>
        </div>
    </div>
);

const DatapointsForm: React.FC<DatapointsFormProps> = ({ initialData, onDataChange }) => {
  const [formData, setFormData] = useState<SiteDatapoints>(initialData);

  useEffect(() => {
    setFormData(initialData);
  }, [initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const updatedData = { ...formData, [name]: value === '' ? 0 : parseFloat(value) };
    setFormData(updatedData);
    onDataChange(updatedData);
  };

  return (
    <div className="w-full bg-black/20 border border-gray-700/50 rounded-lg p-4 flex flex-col gap-4">
        <h3 className="text-base font-semibold text-center text-gray-300">Adjust Site Parameters</h3>
        <div className="space-y-2">
            <div>
                <h4 className="font-semibold text-gray-400 text-sm border-b border-gray-600 pb-1 mb-1">Coverage Constraints</h4>
                <FormRow label="Max Buildable Coverage" unit="%" name="maxBuildableCoverage" value={formData.maxBuildableCoverage} onChange={handleChange} />
                <FormRow label="Min Green Coverage" unit="%" name="minGreenCoverage" value={formData.minGreenCoverage} onChange={handleChange} />
                <FormRow label="Min Open Space" unit="%" name="minOpenSpace" value={formData.minOpenSpace} onChange={handleChange} />
            </div>
             <div>
                <h4 className="font-semibold text-gray-400 text-sm border-b border-gray-600 pb-1 mb-1">Lot Standards</h4>
                <FormRow label="Min Lot Size" unit="sq ft" name="minLotSize" value={formData.minLotSize} onChange={handleChange} />
                <FormRow label="Min Lot Width" unit="ft" name="minLotWidth" value={formData.minLotWidth} onChange={handleChange} />
                <FormRow label="Min Number of Lots" unit="" name="minNumLots" value={formData.minNumLots} onChange={handleChange} />
            </div>
             <div>
                <h4 className="font-semibold text-gray-400 text-sm border-b border-gray-600 pb-1 mb-1">Setback Requirements</h4>
                <FormRow label="Front" unit="ft" name="frontSetback" value={formData.frontSetback} onChange={handleChange} />
                <FormRow label="Rear" unit="ft" name="rearSetback" value={formData.rearSetback} onChange={handleChange} />
                <FormRow label="Side" unit="ft" name="sideSetback" value={formData.sideSetback} onChange={handleChange} />
            </div>
             <div>
                <h4 className="font-semibold text-gray-400 text-sm border-b border-gray-600 pb-1 mb-1">Infrastructure</h4>
                <FormRow label="Road Width" unit="ft" name="roadWidth" value={formData.roadWidth} onChange={handleChange} />
                <FormRow label="Sidewalk Width" unit="ft" name="sidewalkWidth" value={formData.sidewalkWidth} onChange={handleChange} />
            </div>
        </div>
    </div>
  );
};

export default DatapointsForm;