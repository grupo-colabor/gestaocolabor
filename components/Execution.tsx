import React, { useState } from 'react';
import { useApp } from '../App';
import { ExecutionRecord } from '../types';

const Execution: React.FC = () => {
  const { demands, companies, trainings, instructors, regions, isCompanyFullLogistics, updateDemand } = useApp();
  const [selectedDemandId, setSelectedDemandId] = useState<string>('');
  
  // Filter only allocated or completed demands for execution view
  const activeDemands = demands.filter(d => ['ALOCADA', 'CONCLUIDA'].includes(d.status));
  
  const selectedDemand = demands.find(d => d.id === selectedDemandId);
  const selectedCompany = selectedDemand ? companies.find(c => c.id === selectedDemand.companyId) : null;
  const isLogisticsComplete = selectedDemand ? isCompanyFullLogistics(selectedDemand.companyId) : false;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDemand) {
        // In a real app, we would gather form data here. 
        // For this refactor, we mock the record creation based on the selected demand.
        const record: ExecutionRecord = {
            ...selectedDemand,
            // Mocking execution fields for demonstration
            status: 'CONCLUIDA'
        };
        updateDemand(record);
        setSelectedDemandId('');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Controle de Execução</h1>
      
      {/* Selector */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <label className="block text-sm font-medium text-gray-700 mb-2">Selecione o Treinamento para Gerenciar</label>
        <select 
          className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
          value={selectedDemandId}
          onChange={(e) => setSelectedDemandId(e.target.value)}
        >
          <option value="">Selecione...</option>
          {activeDemands.map(d => {
            const tName = trainings.find(t => t.id === d.trainingId)?.name;
            const cName = companies.find(c => c.id === d.companyId)?.name;
            return (
              <option key={d.id} value={d.id}>
                {d.id} - {cName} - {tName} ({new Date(d.startDate).toLocaleDateString()})
              </option>
            );
          })}
        </select>
      </div>

      {selectedDemand && selectedCompany && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
             <h2 className="font-bold text-gray-700">Detalhes da Execução</h2>
             <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded">
                Logística: {selectedCompany.logisticsType}
             </span>
          </div>
          
          <div className="p-6">
            <form className="space-y-6" onSubmit={handleSubmit}>
              {/* General Fields (Common) */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide border-b border-gray-100 pb-2 mb-4">Dados Gerais</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Instrutor</label>
                    <input disabled value={instructors.find(i => i.id === selectedDemand.instructorId)?.name} className="w-full bg-gray-100 border border-gray-300 rounded px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Localidade</label>
                    <input disabled value={regions.find(r => r.id === selectedDemand.regionId)?.name} className="w-full bg-gray-100 border border-gray-300 rounded px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Matriculador (Resp.)</label>
                    <input type="text" className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:border-blue-500 outline-none" />
                  </div>
                </div>
              </div>

              {/* Conditional Fields (Logistics Complete) */}
              {isLogisticsComplete && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                  <h3 className="text-sm font-bold text-blue-900 uppercase tracking-wide border-b border-blue-200 pb-2 mb-4">
                    Campos Específicos (VALE / Completa)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                     <div>
                        <label className="block text-xs font-medium text-blue-800 mb-1">Corredor</label>
                        <input type="text" className="w-full border border-blue-200 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" />
                     </div>
                     <div>
                        <label className="block text-xs font-medium text-blue-800 mb-1">Localizador</label>
                        <input type="text" className="w-full border border-blue-200 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" />
                     </div>
                     <div>
                        <label className="block text-xs font-medium text-blue-800 mb-1">ID Oferta</label>
                        <input type="text" className="w-full border border-blue-200 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" />
                     </div>
                     <div>
                        <label className="block text-xs font-medium text-blue-800 mb-1">Check-in</label>
                        <input type="time" className="w-full border border-blue-200 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" />
                     </div>
                     <div>
                        <label className="block text-xs font-medium text-blue-800 mb-1">Aprovador</label>
                        <input type="text" className="w-full border border-blue-200 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" />
                     </div>
                     <div>
                        <label className="block text-xs font-medium text-blue-800 mb-1">Analista</label>
                        <input type="text" className="w-full border border-blue-200 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" />
                     </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-4">
                <button type="submit" className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-6 rounded-lg transition-colors">
                  Salvar Execução
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Execution;