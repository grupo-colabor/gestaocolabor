import React, { useEffect, useState } from 'react';
import { useApp } from '../App';
import {
  Company,
  Instructor,
  Training,
  Status,
  InstructorSkill,
  Segment,
  LogisticsType,
  TrainingCategory,
  Modality,
  OperationalBaseKey
} from '../types';
import {
  X,
  Plus,
  Trash2,
  Check,
  UserPlus,
  Info,
  Edit3,
  Building2,
  MapPin,
  User,
  BookOpen,
  FolderOpen,
  Award,
  Target,
  Settings,
  AlertCircle
} from 'lucide-react';
import { SKILL_LABELS } from '../constants';
import { supabase } from '../lib/supabase';
import { AUTH_MODE } from '../config/authMode';
import { deleteOperationalBaseItem } from '../services/operationalBases';

type Tab = 'companies' | 'trainings' | 'instructors' | 'bases' | 'settings';

const SEGMENTS: Segment[] = ['Indústria', 'Comércio', 'Serviços', 'Educação', 'Saúde', 'Outros'];

const TRAINING_CATEGORIES: TrainingCategory[] = [
  'Segurança do Trabalho',
  'Manutenção Industrial',
  'Operação de Equipamentos',
  'Emergência',
  'Operação Ferroviária',
  'Técnicos Elétrica',
  'Técnicos Solda',
  'Treinamentos Comportamentais'
];

const BASE_LABELS: Record<OperationalBaseKey, string> = {
  aprovadores: 'Aprovadores',
  analistas: 'Analistas',
  corredores: 'Corredores',
  localidades: 'Localidades',
  locaisTreinamento: 'Local de Treinamento',
  hoteis: 'Hotéis',
  locadoras: 'Empresas de Locação',
  tiposTreinamento: 'Tipos de Treinamento',
  matriculadores: 'Matriculadores'
};

const Registrations: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('companies');
  const {
    companies, trainings, instructors, regions, operationalBases, nextDemandNumber,
    addInstructor, updateInstructor, addCompany, updateCompany, addTraining, updateTraining, updateOperationalBase, setNextDemandNumber,reloadInstructors
  } = useApp();

  // --- Training Modal State ---
  const [isTrainingModalOpen, setIsTrainingModalOpen] = useState(false);
  const [editingTrainingId, setEditingTrainingId] = useState<string | null>(null);
  const [trainingFormData, setTrainingFormData] = useState<Partial<Training>>({
    name: '',
    nr: '',
    category: undefined,
    status: 'ATIVO',
    modality: 'PRESENCIAL',
    hours: 8,
    descriptionShort: '',
    descriptionDetailed: '',
    prerequisites: '',
    targetAudience: '',
    emitsCertificate: true,
    validityMonths: 12,
    areaId: '1'
  });

  // --- Company Modal State ---
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [companyFormData, setCompanyFormData] = useState<Partial<Company>>({
    razaoSocial: '',
    name: '',
    cnpj: '',
    status: 'ATIVO',
    segment: 'Indústria',
    logisticsType: 'SIMPLIFICADA',
    address: {},
    contact: {},
    observations: ''
  });

  // --- Instructor Modal State ---
  const [isInstructorModalOpen, setIsInstructorModalOpen] = useState(false);
  const [editingInstructorId, setEditingInstructorId] = useState<string | null>(null);

  // ✅ Estado de submit do modal de instrutor
  const [isInstructorSubmitting, setIsInstructorSubmitting] = useState(false);

  const [instructorFormData, setInstructorFormData] = useState<{
    name: string;
    email: string;
    status: Status;
    regionIds: string[];
    skills: InstructorSkill[];
    observations: string;
    residenceLocation: string;
    coverageLocations: string[];
  }>({
    name: '',
    email: '',
    status: 'ATIVO',
    regionIds: [],
    skills: [],
    observations: '',
    residenceLocation: '',
    coverageLocations: [],
  });

  const [tempSkill, setTempSkill] = useState<{ trainingId: string; level: number }>({
    trainingId: '',
    level: 3
  });

  // --- Operational Bases Management State ---
  const [activeBaseKey, setActiveBaseKey] = useState<OperationalBaseKey>('aprovadores');
  const [newBaseItem, setNewBaseItem] = useState('');
  const [editingBaseIdx, setEditingBaseIdx] = useState<number | null>(null);
  const [editBaseValue, setEditBaseValue] = useState('');

  // ✅ sempre que abrir/fechar o modal, reseta o submitting
  useEffect(() => {
    if (isInstructorModalOpen) {
      setIsInstructorSubmitting(false);
    }
  }, [isInstructorModalOpen]);

  // ✅ Aceita PromiseLike (inclui PostgrestBuilder do Supabase) e converte pra Promise real
  const withTimeout = async <T,>(
    promiseLike: PromiseLike<T>,
    ms: number,
    label: string
  ): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Timeout (${ms}ms) em: ${label}`)), ms);
    });

    try {
      // PostgrestBuilder é "thenable" => Promise.resolve transforma em Promise de verdade
      const promise = Promise.resolve(promiseLike);
      return (await Promise.race([promise, timeoutPromise])) as T;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  // --- Training Handlers ---
  const handleOpenTrainingCreateModal = () => {
    setEditingTrainingId(null);
    setTrainingFormData({
      name: '', nr: '', category: undefined, status: 'ATIVO', modality: 'PRESENCIAL', hours: 8,
      descriptionShort: '', descriptionDetailed: '', prerequisites: '', targetAudience: '',
      emitsCertificate: true, validityMonths: 12, areaId: '1'
    });
    setIsTrainingModalOpen(true);
  };

  const handleOpenTrainingEditModal = (training: Training) => {
    setEditingTrainingId(training.id);
    setTrainingFormData({ ...training });
    setIsTrainingModalOpen(true);
  };

  const handleSaveTraining = () => {
    if (!trainingFormData.name) return alert('O nome do treinamento é obrigatório.');
    if (!trainingFormData.category) return alert('A categoria é obrigatória.');
    if (!trainingFormData.hours) return alert('A carga horária é obrigatória.');

    if (editingTrainingId) {
      updateTraining(trainingFormData as Training);
    } else {
      addTraining({ ...(trainingFormData as Training), id: `TRAIN-${Date.now()}` });
    }
    setIsTrainingModalOpen(false);
  };

  // --- Company Handlers ---
  const handleOpenCompanyCreateModal = () => {
    setEditingCompanyId(null);
    setCompanyFormData({
      razaoSocial: '',
      name: '',
      cnpj: '',
      status: 'ATIVO',
      segment: 'Indústria',
      logisticsType: 'SIMPLIFICADA',
      address: {},
      contact: {},
      observations: ''
    });
    setIsCompanyModalOpen(true);
  };

  const handleOpenCompanyEditModal = (company: Company) => {
    setEditingCompanyId(company.id);
    setCompanyFormData({ ...company });
    setIsCompanyModalOpen(true);
  };

  const handleSaveCompany = () => {
    if (!companyFormData.razaoSocial || !companyFormData.name) return alert('Razão Social e Nome Fantasia são obrigatórios.');
    if (editingCompanyId) {
      updateCompany(companyFormData as Company);
    } else {
      addCompany({ ...(companyFormData as Company), id: `COMP-${Date.now()}` });
    }
    setIsCompanyModalOpen(false);
  };

  // --- Instructor Handlers ---
  const handleOpenInstructorCreateModal = () => {
    setEditingInstructorId(null);
    setInstructorFormData({ name: '', email: '', status: 'ATIVO', regionIds: [], skills: [], observations: '', residenceLocation: '', coverageLocations: []});
    setTempSkill({ trainingId: '', level: 3 });

    // ✅ garante que sempre abre “destravado”
    setIsInstructorSubmitting(false);

    setIsInstructorModalOpen(true);
  };

  const handleOpenInstructorEditModal = (instructor: Instructor) => {
    setEditingInstructorId(instructor.id);
    setInstructorFormData({
      name: instructor.name,
      email: (instructor as any).email || '',
      status: instructor.status,
      regionIds: [...instructor.regionIds],
      skills: [...instructor.skills.map(s => ({ ...s }))],
      observations: instructor.observations || '',
      residenceLocation: instructor.residenceLocation || '',
      coverageLocations: Array.isArray(instructor.coverageLocations) ? instructor.coverageLocations : [],

    });

    setTempSkill({ trainingId: '', level: 3 });

    // ✅ garante que sempre abre “destravado”
    setIsInstructorSubmitting(false);

    setIsInstructorModalOpen(true);
  };

  const toggleRegionSelection = (regionId: string) => {
    setInstructorFormData(prev => {
      const exists = prev.regionIds.includes(regionId);
      if (exists) {
        return { ...prev, regionIds: prev.regionIds.filter(id => id !== regionId) };
      }
      return { ...prev, regionIds: [...prev.regionIds, regionId] };
    });
  };

    const toggleCoverageLocation = (loc: string) => {
    setInstructorFormData(prev => {
      const exists = prev.coverageLocations.includes(loc);
      return {
        ...prev,
        coverageLocations: exists
          ? prev.coverageLocations.filter(x => x !== loc)
          : [...prev.coverageLocations, loc]
      };
    });
  };

  const handleAddSkill = () => {
    if (!tempSkill.trainingId) return alert('Selecione um treinamento.');
    if (instructorFormData.skills.some(s => s.trainingId === tempSkill.trainingId)) {
      return alert('Este treinamento já foi adicionado para este instrutor.');
    }

    setInstructorFormData(prev => ({
      ...prev,
      skills: [...prev.skills, { ...tempSkill as InstructorSkill }]
    }));
    setTempSkill({ trainingId: '', level: 3 });
  };

  const handleRemoveSkill = (trainingId: string) => {
    setInstructorFormData(prev => ({
      ...prev,
      skills: prev.skills.filter(s => s.trainingId !== trainingId)
    }));
  };

  const toDbLevel = (level: number) => {
    if (level >= 4) return 'ESPECIALISTA';
    if (level === 3) return 'AVANCADO';
    if (level === 2) return 'INTERMEDIARIO';
    return 'BASICO';
  };

  const getDbRegion = (regionIds: string[]) => {
    const first = regionIds[0];
    const region = regions.find(r => r.id === first);
    return region?.name || null;
  };

  // ✅ Atualizado: mock separado + guard de sessão no lugar certo + timeouts
  const handleSaveInstructor = async () => {
    console.log('[handleSaveInstructor] click', { isInstructorSubmitting, AUTH_MODE });

    if (isInstructorSubmitting) return;

    if (!instructorFormData.name.trim()) {
      alert('O nome do instrutor é obrigatório.');
      return;
    }

    if (instructorFormData.regionIds.length === 0) {
      alert('Selecione pelo menos uma região de atuação.');
      return;
    }

    if (instructorFormData.skills.length === 0) {
      alert('Adicione pelo menos um treinamento que o instrutor ministra.');
      return;
    }

    setIsInstructorSubmitting(true);

    // 1) MOCK (sem supabase)
    if (AUTH_MODE !== 'supabase') {
      try {
        const fallback: Instructor = {
          id: editingInstructorId || `INST-${Date.now()}`,
          name: instructorFormData.name,
          status: instructorFormData.status,
          regionIds: instructorFormData.regionIds,
          skills: instructorFormData.skills,
          observations: instructorFormData.observations,
        };
        (fallback as any).email = instructorFormData.email;

        editingInstructorId ? updateInstructor(fallback) : addInstructor(fallback);
        setIsInstructorModalOpen(false);
      } finally {
        setIsInstructorSubmitting(false);
      }
      return;
    }

    // 2) FLUXO SUPABASE
    try {
      const isActive = instructorFormData.status === 'ATIVO';
      const dbRegion = getDbRegion(instructorFormData.regionIds);

      let instructorId = editingInstructorId;

      // 2.1) INSERT ou UPDATE instructor
      if (editingInstructorId) {
        console.log('[handleSaveInstructor] step=update_instructor', editingInstructorId);

        const { data, error } = await withTimeout(
          supabase
            .from('instructors')
            .update({
              full_name: instructorFormData.name,
              email: instructorFormData.email || null,
              region: dbRegion,
              is_active: isActive,
              residence_location: instructorFormData.residenceLocation || null,
              coverage_locations: instructorFormData.coverageLocations,
            })
            .eq('id', editingInstructorId)
            .select('id')
            .single(),
          15000,
          'instructors.update'
        );

        if (error) throw error;
        instructorId = (data as any).id;
      } else {
        console.log('[handleSaveInstructor] step=insert_instructor');

        const { data, error } = await withTimeout(
          supabase
            .from('instructors')
            .insert({
              full_name: instructorFormData.name,
              email: instructorFormData.email || null,
              region: dbRegion,
              is_active: isActive,
              residence_location: instructorFormData.residenceLocation || null,
              coverage_locations: instructorFormData.coverageLocations,
            })
            .select('id')
            .single(),
          15000,
          'instructors.insert'
        );

        if (error) throw error;
        instructorId = (data as any).id;
      }

      if (!instructorId) {
        throw new Error('Não foi possível obter o ID do instrutor.');
      }

      // 2.2) DELETE pivot
      console.log('[handleSaveInstructor] step=delete_pivot', instructorId);

      const { error: delErr } = await withTimeout(
        supabase
          .from('instructor_trainings')
          .delete()
          .eq('instructor_id', instructorId),
        15000,
        'instructor_trainings.delete'
      );

      if (delErr) throw delErr;

      // 2.3) INSERT pivot
      console.log('[handleSaveInstructor] step=insert_pivot', instructorFormData.skills.length);

      const rows = instructorFormData.skills.map(s => ({
        instructor_id: instructorId!,
        training_id: s.trainingId,
        level: toDbLevel(s.level),
      }));

      const { error: insErr } = await withTimeout(
        supabase
          .from('instructor_trainings')
          .insert(rows),
        15000,
        'instructor_trainings.insert'
      );

      if (insErr) throw insErr;

      // ✅ 2.4) FONTE DA VERDADE → recarrega tudo do banco
      await reloadInstructors();

      setIsInstructorModalOpen(false);
    } catch (e: any) {
      console.error('[handleSaveInstructor] ERROR', e);
      alert(`Erro ao salvar instrutor: ${e?.message || 'erro desconhecido'}`);
    } finally {
      setIsInstructorSubmitting(false);
    }
  };


  // --- Operational Bases Handlers ---
  const handleAddBaseItem = () => {
    if (!newBaseItem.trim()) return;
    const currentList = operationalBases[activeBaseKey] ?? [];
    if (currentList.includes(newBaseItem.trim())) return alert('Item já existe na base.');
    updateOperationalBase(activeBaseKey, [...currentList, newBaseItem.trim()]);
    setNewBaseItem('');
  };


const handleRemoveBaseItem = async (item: string) => {
  const value = (item ?? '').trim();
  if (!value) return;

  const ok = confirm(`Deseja remover "${value}" da base?`);
  if (!ok) return;

  try {
    // 1) remove no Supabase
    await deleteOperationalBaseItem(activeBaseKey, value);

    // 2) remove no estado local (UI atualiza na hora)
    updateOperationalBase(
      activeBaseKey,
      (operationalBases[activeBaseKey] || []).filter(i => (i ?? '').trim() !== value)
    );
  } catch (e: any) {
    console.error(e);
    alert(`Erro ao remover: ${e?.message || e}`);
  }
};


  const startEditBaseItem = (idx: number, val: string) => {
    setEditingBaseIdx(idx);
    setEditBaseValue(val);
  };

  const saveEditBaseItem = () => {
    if (editingBaseIdx === null || !editBaseValue.trim()) return;

    const newList = [...(operationalBases?.[activeBaseKey] ?? [])];
    newList[editingBaseIdx] = editBaseValue.trim();

    updateOperationalBase(activeBaseKey, newList);
    setEditingBaseIdx(null);
  };
  
  const currentBaseItems = operationalBases?.[activeBaseKey] ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-800">Cadastros Gerais</h1>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-1 bg-white p-1 rounded-xl shadow-sm border border-gray-200 w-fit">
        {(['companies', 'trainings', 'instructors', 'bases', 'settings'] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
              activeTab === tab
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            {tab === 'companies' && <Building2 size={16} />}
            {tab === 'trainings' && <BookOpen size={16} />}
            {tab === 'instructors' && <User size={16} />}
            {tab === 'bases' && <FolderOpen size={16} />}
            {tab === 'settings' && <Settings size={16} />}

            {tab === 'companies' ? 'Empresas' :
             tab === 'trainings' ? 'Treinamentos' :
             tab === 'instructors' ? 'Instrutores' :
             tab === 'bases' ? 'Bases Operacionais' : 'Configurações'}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 min-h-[500px]">
        {activeTab === 'companies' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-gray-700">Empresas / Clientes</h2>
              <button
                type="button"
                onClick={handleOpenCompanyCreateModal}
                className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800 flex items-center transition shadow-sm font-bold"
              >
                <Plus size={18} className="mr-2" /> Nova Empresa
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {companies.map(company => (
                <div key={company.id} className="border border-gray-200 p-4 rounded-xl flex items-start space-x-4 hover:shadow-md transition-all bg-white relative group">
                  <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-600 font-bold text-lg border border-gray-200">
                    <Building2 size={24} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <h3 className="font-bold text-gray-800 truncate pr-8" title={company.razaoSocial}>{company.name}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${company.status === 'ATIVO' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{company.status}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 truncate">{company.razaoSocial}</p>
                    <div className="mt-3 flex flex-col space-y-1">
                      <div className="flex items-center text-[10px] text-gray-400"><MapPin size={10} className="mr-1" />{company.address?.cidade || 'Cidade não inf.'} - {company.address?.estado || 'UF'}</div>
                      <div className="flex items-center text-[10px] text-gray-400"><Info size={10} className="mr-1" />{company.segment || 'Segmento não inf.'}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenCompanyEditModal(company)}
                    className="absolute top-4 right-4 p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100 shadow-sm border border-gray-100 bg-white"
                  >
                    <Edit3 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'trainings' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-gray-700">Catálogo de Treinamentos</h2>
              <button
                type="button"
                onClick={handleOpenTrainingCreateModal}
                className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800 flex items-center transition shadow-sm font-bold"
              >
                <Plus size={18} className="mr-2" /> + Novo Treinamento
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="p-4">Treinamento</th>
                    <th className="p-4">Código / NR</th>
                    <th className="p-4">Categoria</th>
                    <th className="p-4">Modalidade</th>
                    <th className="p-4">Carga Horária</th>
                    <th className="p-4 text-center">Status</th>
                    <th className="p-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {trainings.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                      <td className="p-4">
                        <div className="font-bold text-gray-800">{t.name}</div>
                        <div className="text-[10px] text-gray-400 truncate max-w-xs">{t.descriptionShort || 'Sem descrição'}</div>
                      </td>
                      <td className="p-4 text-gray-600 font-mono text-sm">{t.nr || '-'}</td>
                      <td className="p-4">
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-200">{t.category}</span>
                      </td>
                      <td className="p-4 text-gray-600 text-xs font-semibold uppercase">{t.modality}</td>
                      <td className="p-4 text-gray-600 text-sm font-medium">{t.hours ? `${t.hours}h` : '-'}</td>
                      <td className="p-4 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${t.status === 'ATIVO' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{t.status}</span>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenTrainingEditModal(t)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Edit3 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- BASES OPERACIONAIS --- */}
        {activeTab === 'bases' && (
          <div className="animate-fade-in flex flex-col h-full">
            <div className="mb-6">
              <h2 className="text-lg font-bold text-gray-700">Gerenciamento de Bases Operacionais</h2>
              <p className="text-sm text-gray-500">Mantenha as listas de autocompletes e opções do sistema atualizadas.</p>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 flex-1">
              {/* Menu Lateral da Base */}
              <div className="w-full lg:w-64 space-y-1">
                {(Object.keys(BASE_LABELS) as OperationalBaseKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setActiveBaseKey(key);
                      setEditingBaseIdx(null);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-between group
                      ${activeBaseKey === key
                        ? 'bg-blue-50 text-blue-700 border-2 border-blue-200'
                        : 'bg-white text-gray-600 border border-transparent hover:bg-gray-50 hover:border-gray-200'}`}
                  >
                    {BASE_LABELS[key]}
                    <span className="bg-gray-100 text-gray-500 text-[10px] px-2 py-0.5 rounded-full font-black group-hover:bg-blue-100 group-hover:text-blue-600">
                      {(operationalBases?.[key] ?? []).length}
                    </span>
                  </button>
                ))}
              </div>

              {/* Lista e Adição */}
              <div className="flex-1 flex flex-col bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden shadow-inner">
                <div className="p-4 bg-white border-b border-gray-200">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Plus className="absolute left-3 top-3 text-gray-400" size={18} />
                      <input
                        type="text"
                        placeholder={`Adicionar novo ${BASE_LABELS[activeBaseKey].toLowerCase()}...`}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        value={newBaseItem}
                        onChange={(e) => setNewBaseItem(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddBaseItem()}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddBaseItem}
                      className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-md hover:bg-blue-700 transition"
                    >
                      Adicionar
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {operationalBases[activeBaseKey].map((item, idx) => (
                    <div key={`${item}-${idx}`} className="flex items-center justify-between bg-white p-3 rounded-xl border border-gray-200 group hover:border-blue-300 transition-colors shadow-sm">
                      {editingBaseIdx === idx ? (
                        <div className="flex-1 flex gap-2">
                          <input
                            autoFocus
                            className="flex-1 border-b-2 border-blue-500 outline-none font-bold text-sm"
                            value={editBaseValue}
                            onChange={(e) => setEditBaseValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEditBaseItem()}
                          />
                          <button type="button" onClick={saveEditBaseItem} className="text-green-600 hover:bg-green-50 p-1 rounded transition"><Check size={18} /></button>
                          <button type="button" onClick={() => setEditingBaseIdx(null)} className="text-gray-400 hover:bg-gray-50 p-1 rounded transition"><X size={18} /></button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm font-medium text-gray-700">{item}</span>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => startEditBaseItem(idx, item)}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                              title="Editar"
                            >
                              <Edit3 size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveBaseItem(item)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                              title="Remover"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {currentBaseItems.length === 0 && (
                    <div className="text-center py-12 text-gray-400 italic">
                      Nenhum item cadastrado nesta base.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Instrutores */}
        {activeTab === 'instructors' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-gray-700">Base de Instrutores</h2>
              <button
                type="button"
                onClick={handleOpenInstructorCreateModal}
                className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800 flex items-center transition shadow-sm font-bold"
              >
                <UserPlus size={18} className="mr-2" /> + Novo Instrutor
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {instructors.map(inst => (
                <div key={inst.id} className="border border-gray-200 p-4 rounded-xl flex items-start space-x-4 hover:shadow-md transition-all bg-white relative group">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg border border-blue-200">
                    {inst.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <h3 className="font-bold text-gray-800 truncate pr-8">{inst.name}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${inst.status === 'ATIVO' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{inst.status}</span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-1">
                      <span className="font-semibold">Regiões:</span> {inst.regionIds.map(rid => regions.find(r => r.id === rid)?.name).join(', ')}
                    </p>
                    <div className="mt-3">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Skills principais:</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {inst.skills.slice(0, 3).map(s => (
                          <span key={s.trainingId} className="text-[9px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-100 font-medium">
                            {trainings.find(t => t.id === s.trainingId)?.name.split(' ')[0]} (Lv {s.level})
                          </span>
                        ))}
                        {inst.skills.length > 3 && <span className="text-[9px] text-gray-400 font-bold">+{inst.skills.length - 3}</span>}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenInstructorEditModal(inst)}
                    className="absolute top-4 right-4 p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100 shadow-sm border border-gray-100 bg-white"
                  >
                    <Edit3 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- CONFIGURAÇÕES --- */}
        {activeTab === 'settings' && (
          <div className="animate-fade-in max-w-2xl">
            <div className="mb-8">
              <h2 className="text-lg font-bold text-gray-700">Configurações Gerais do Sistema</h2>
              <p className="text-sm text-gray-500">Ajuste parâmetros de funcionamento da plataforma.</p>
            </div>

            <div className="space-y-6">
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-white rounded-xl text-blue-600 shadow-sm border border-slate-100">
                    <Settings size={24} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Sequencial de Demandas</h3>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Controle manual da próxima ID</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="max-w-xs">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Próximo número da demanda</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-black text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                      value={nextDemandNumber}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val > 0) {
                          setNextDemandNumber(val);
                        }
                      }}
                    />
                  </div>
                  <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 flex items-start gap-3">
                    <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-black text-amber-700 uppercase tracking-tight">Aviso Importante</p>
                      <p className="text-[11px] font-medium text-amber-600 leading-relaxed mt-1">
                        Alterar este valor afetará apenas as novas demandas. As IDs serão geradas no formato <span className="font-bold">DEM-{"{número}"}</span>.
                        Certifique-se de não definir um número que possa causar duplicidade visual com demandas já existentes no histórico.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* --- MODAL DE EMPRESAS --- */}
      {isCompanyModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <div><h2 className="text-xl font-bold text-gray-800">{editingCompanyId ? 'Editar Empresa' : 'Nova Empresa'}</h2></div>
              <button type="button" onClick={() => setIsCompanyModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-lg transition"><X size={24} /></button>
            </div>
            <div className="p-8 overflow-y-auto space-y-8 flex-1">
              <section>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Building2 size={14} /> Dados Cadastrais</h3>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  <div className="md:col-span-8">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Razão Social *</label>
                    <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={companyFormData.razaoSocial || ''} onChange={(e) => setCompanyFormData({ ...companyFormData, razaoSocial: e.target.value })} />
                  </div>
                  <div className="md:col-span-4">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome Fantasia *</label>
                    <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={companyFormData.name || ''} onChange={(e) => setCompanyFormData({ ...companyFormData, name: e.target.value })} />
                  </div>
                  <div className="md:col-span-4">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CNPJ</label>
                    <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={companyFormData.cnpj || ''} onChange={(e) => setCompanyFormData({ ...companyFormData, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
                  </div>
                  <div className="md:col-span-4">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Segmento</label>
                    <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={companyFormData.segment || 'Outros'} onChange={(e) => setCompanyFormData({ ...companyFormData, segment: e.target.value as Segment })}>
                      {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status</label>
                    <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={companyFormData.status} onChange={(e) => setCompanyFormData({ ...companyFormData, status: e.target.value as Status })}>
                      <option value="ATIVO">Ativo</option>
                      <option value="INATIVO">Inativo</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Logística</label>
                    <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={companyFormData.logisticsType} onChange={(e) => setCompanyFormData({ ...companyFormData, logisticsType: e.target.value as LogisticsType })}>
                      <option value="SIMPLIFICADA">Simplificada</option>
                      <option value="COMPLETA">Completa (VALE)</option>
                    </select>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><MapPin size={14} /> Endereço</h3>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  <div className="md:col-span-4">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cidade</label>
                    <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={companyFormData.address?.cidade || ''} onChange={(e) => setCompanyFormData({ ...companyFormData, address: { ...companyFormData.address, cidade: e.target.value } })} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Estado</label>
                    <input type="text" maxLength={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 uppercase" value={companyFormData.address?.estado || ''} onChange={(e) => setCompanyFormData({ ...companyFormData, address: { ...companyFormData.address, estado: e.target.value } })} />
                  </div>
                  <div className="md:col-span-6">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Observações Operacionais</label>
                    <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={companyFormData.observations || ''} onChange={(e) => setCompanyFormData({ ...companyFormData, observations: e.target.value })} placeholder="Notas importantes sobre esta empresa..." />
                  </div>
                </div>
              </section>
            </div>
            <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end space-x-3">
              <button type="button" onClick={() => setIsCompanyModalOpen(false)} className="px-6 py-2.5 text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg font-bold text-sm">Cancelar</button>
              <button type="button" onClick={handleSaveCompany} className="px-8 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-lg shadow-md text-sm flex items-center">
                <Check size={18} className="mr-2" />{editingCompanyId ? 'Salvar Alterações' : 'Criar Empresa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL DE TREINAMENTOS --- */}
      {isTrainingModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <div><h2 className="text-xl font-bold text-gray-800">{editingTrainingId ? 'Editar Treinamento' : 'Novo Treinamento'}</h2></div>
              <button type="button" onClick={() => setIsTrainingModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-lg transition"><X size={24} /></button>
            </div>
            <div className="p-8 overflow-y-auto space-y-8 flex-1">
              <section>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  <div className="md:col-span-8">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Treinamento *</label>
                    <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={trainingFormData.name || ''} onChange={(e) => setTrainingFormData({ ...trainingFormData, name: e.target.value })} />
                  </div>
                  <div className="md:col-span-4">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Código Interno</label>
                    <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={trainingFormData.nr || ''} onChange={(e) => setTrainingFormData({ ...trainingFormData, nr: e.target.value })} />
                  </div>

                  <div className="md:col-span-12">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-3">Categoria *</label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {TRAINING_CATEGORIES.map(category => (
                        <button
                          key={category}
                          type="button"
                          onClick={() => setTrainingFormData({ ...trainingFormData, category })}
                          className={`px-3 py-2 text-[10px] font-bold rounded-lg border transition-all text-center leading-tight h-12 flex items-center justify-center ${
                            trainingFormData.category === category ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
                          }`}
                        >
                          {category}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="md:col-span-6">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Carga Horária (em horas) *</label>
                    <input type="number" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={trainingFormData.hours || ''} onChange={(e) => setTrainingFormData({ ...trainingFormData, hours: Number(e.target.value) })} />
                  </div>

                  <div className="md:col-span-6">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Modalidade *</label>
                    <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={trainingFormData.modality} onChange={(e) => setTrainingFormData({ ...trainingFormData, modality: e.target.value as Modality })}>
                      <option value="PRESENCIAL">Presencial</option>
                      <option value="HIBRIDO">Híbrido</option>
                      <option value="ONLINE">100% Online</option>
                      <option value="TUTORIA">Tutoria</option>
                    </select>
                  </div>

                  <div className="md:col-span-12">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Observações / Informações Importantes</label>
                    <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 h-24 resize-none" value={trainingFormData.descriptionShort || ''} onChange={(e) => setTrainingFormData({ ...trainingFormData, descriptionShort: e.target.value })} placeholder="Ex: Necessita EPI, treinamento prático, avaliação obrigatória..." />
                  </div>
                </div>
              </section>
            </div>
            <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end space-x-3">
              <button type="button" onClick={() => setIsTrainingModalOpen(false)} className="px-6 py-2.5 text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg font-bold text-sm">Cancelar</button>
              <button type="button" onClick={handleSaveTraining} className="px-8 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-lg shadow-md text-sm flex items-center">
                <Check size={18} className="mr-2" />{editingTrainingId ? 'Salvar Alterações' : 'Criar Treinamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL DE INSTRUTORES --- */}
      {isInstructorModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <div><h2 className="text-xl font-bold text-gray-800">{editingInstructorId ? 'Editar Instrutor' : 'Novo Instrutor'}</h2></div>
              <button
                type="button"
                onClick={() => {
                  setIsInstructorModalOpen(false);
                  setIsInstructorSubmitting(false);
                }}
                className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-lg transition"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-8 overflow-y-auto space-y-8 flex-1">
              {/* Dados Básicos */}
              <section>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><User size={14} /> Identificação Básica</h3>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  <div className="md:col-span-6">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome Completo *</label>
                    <input
                      type="text"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      value={instructorFormData.name}
                      onChange={(e) => setInstructorFormData({ ...instructorFormData, name: e.target.value })}
                      placeholder="Ex: Carlos Augusto Silva"
                    />
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                    <input
                      type="email"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      value={instructorFormData.email}
                      onChange={(e) => setInstructorFormData({ ...instructorFormData, email: e.target.value })}
                      placeholder="email@empresa.com"
                    />
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status Operacional</label>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      value={instructorFormData.status}
                      onChange={(e) => setInstructorFormData({ ...instructorFormData, status: e.target.value as Status })}
                    >
                      <option value="ATIVO">Ativo (Disponível)</option>
                      <option value="INATIVO">Inativo (Bloqueado)</option>
                    </select>
                  </div>
                </div>
              </section>

              {/* Regiões de Atuação */}
              <section>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><MapPin size={14} /> Regiões de Atuação (Geografia)</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {regions.map(region => (
                    <button
                      key={region.id}
                      type="button"
                      onClick={() => toggleRegionSelection(region.id)}
                      className={`px-3 py-2 text-[10px] font-black rounded-lg border-2 transition-all flex items-center justify-center text-center leading-tight h-10 uppercase
                        ${instructorFormData.regionIds.includes(region.id)
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white text-slate-400 border-slate-100 hover:border-slate-300'}`}
                    >
                      {region.name}
                    </button>
                  ))}
                </div>
              </section>
              
              {/* Localidade / Residência */}
              <section>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <MapPin size={14} /> Localidade e Residência
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  
                {/* Residência (single) */}
                  <div className="md:col-span-5">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                      Local (Residência)
                    </label>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      value={instructorFormData.residenceLocation}
                      onChange={(e) =>
                        setInstructorFormData({ ...instructorFormData, residenceLocation: e.target.value })
                      }
                    >
                      <option value="">Selecione...</option>
                      {operationalBases.localidades.map((loc) => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                    </select>
                  </div>

                  {/* Atende (multi) */}
                  <div className="md:col-span-7">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                      Localidade (Atende) — múltipla
                    </label>

                    <div className="flex flex-wrap gap-2">
                      {operationalBases.localidades.map((loc) => {
                        const selected = instructorFormData.coverageLocations.includes(loc);
                        return (
                          <button
                            key={loc}
                            type="button"
                            onClick={() => toggleCoverageLocation(loc)}
                            className={`px-3 py-2 text-[10px] font-black rounded-lg border-2 transition-all uppercase
                              ${selected
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-white text-slate-400 border-slate-100 hover:border-slate-300'}`}
                            title={loc}
                          >
                            {loc}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-2 text-[11px] text-slate-500">
                      Selecionados: <span className="font-semibold">{instructorFormData.coverageLocations.length}</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Treinamentos e Skills */}
              <section>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Award size={14} /> Competências Técnicas (Skills)</h3>

                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 grid grid-cols-1 md:grid-cols-12 gap-4 items-end mb-6">
                  <div className="md:col-span-7">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Selecionar Treinamento</label>
                    <select
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                      value={tempSkill.trainingId}
                      onChange={(e) => setTempSkill({ ...tempSkill, trainingId: e.target.value })}
                    >
                      <option value="">Selecione um treinamento...</option>
                      {trainings.filter(t => t.status === 'ATIVO').map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.nr || 'S/C'})</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Nível de Domínio</label>
                    <select
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                      value={tempSkill.level}
                      onChange={(e) => setTempSkill({ ...tempSkill, level: Number(e.target.value) })}
                    >
                      {Object.entries(SKILL_LABELS).map(([lv, label]) => (
                        <option key={lv} value={lv}>{label} (Nv {lv})</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <button
                      type="button"
                      onClick={handleAddSkill}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <Plus size={16} /> ADICIONAR
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-300 uppercase tracking-widest mb-2 px-1">Treinamentos Habilitados ({instructorFormData.skills.length})</label>
                  {instructorFormData.skills.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {instructorFormData.skills.map((skill) => {
                        const training = trainings.find(t => t.id === skill.trainingId);
                        return (
                          <div key={skill.trainingId} className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between group hover:border-blue-200 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100">
                                <Target size={20} />
                              </div>
                              <div>
                                <p className="text-xs font-bold text-slate-800 line-clamp-1">{training?.name || 'Não encontrado'}</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className={`text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded
                                    ${skill.level === 4 ? 'bg-purple-100 text-purple-700' :
                                      skill.level === 3 ? 'bg-blue-100 text-blue-700' :
                                      'bg-slate-100 text-slate-600'}`}>
                                    {SKILL_LABELS[skill.level]}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveSkill(skill.trainingId)}
                              className="p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                              title="Remover Skill"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-10 bg-white border-2 border-dashed border-slate-100 rounded-2xl">
                      <p className="text-sm text-slate-400 font-medium italic">Nenhum treinamento vinculado a este instrutor.</p>
                    </div>
                  )}
                </div>
              </section>

              {/* Observações */}
              <section>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">Notas Operacionais</h3>
                <textarea
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 h-28 resize-none shadow-inner bg-slate-50/50"
                  value={instructorFormData.observations}
                  onChange={(e) => setInstructorFormData({ ...instructorFormData, observations: e.target.value })}
                  placeholder="Informações adicionais, restrições, observações de RH ou especialidades..."
                />
              </section>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setIsInstructorModalOpen(false);
                  setIsInstructorSubmitting(false);
                }}
                className="px-6 py-2.5 text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg font-bold text-sm"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleSaveInstructor}
                disabled={isInstructorSubmitting}
                className={`px-8 py-2.5 font-bold rounded-lg shadow-md text-sm flex items-center ${
                  isInstructorSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-gray-900 hover:bg-gray-800 text-white'
                }`}
              >
                <Check size={18} className="mr-2" />
                {isInstructorSubmitting
                  ? 'Salvando...'
                  : (editingInstructorId ? 'Salvar Alterações' : 'Criar Instrutor')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Registrations;
