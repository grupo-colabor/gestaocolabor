
import React, { useState } from 'react';
import { 
  ArrowLeft, 
  Building2, 
  GraduationCap, 
  MapPin, 
  Calendar as CalendarIcon,
  FileText,
  Award,
  ImageIcon,
  MessageSquare,
  Upload,
  Trash2,
  CheckCircle2,
  FilePlus,
  ImagePlus,
  Clock,
  Download,
  DownloadCloud,
  User
} from 'lucide-react';
import { Demand, Company, Training, EvidenceData, EvidenceFile } from '../types';
import { useApp } from '../App';

interface EvidenceDetailsProps {
  demand: Demand;
  company: Company;
  training: Training;
  data: EvidenceData;
  onBack: () => void;
  onUpdate: (updatedData: EvidenceData) => void;
}

const EvidenceDetails: React.FC<EvidenceDetailsProps> = ({ 
  demand, 
  company, 
  training, 
  data, 
  onBack, 
  onUpdate 
}) => {
  const { setNotification, instructors } = useApp();

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '---';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('pt-BR');
  };

  const downloadFile = (file: EvidenceFile) => {
    if (!file.base64) {
      setNotification({ message: "Arquivo não disponível para download nesta sessão.", type: 'error' });
      return;
    }
    const link = document.createElement('a');
    link.href = file.base64;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadAll = (files: EvidenceFile[]) => {
    if (files.length === 0) return;
    files.forEach((file, index) => {
      // Pequeno timeout para evitar bloqueio do navegador ao baixar múltiplos arquivos simultaneamente
      setTimeout(() => {
        downloadFile(file);
      }, index * 200);
    });
  };

  const handleFileUpload = (type: 'attendance' | 'certificate' | 'photo') => {
    const input = document.createElement('input');
    input.type = 'file';
    
    if (type === 'photo') {
      input.multiple = true;
      input.accept = 'image/*';
    } else {
      input.multiple = true;
      input.accept = '.pdf,image/*';
    }

    input.onchange = (e: any) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      if (type === 'attendance') {
        const currentCount = (data.attendanceList || []).length;
        if (currentCount + files.length > 3) {
          setNotification({ 
            message: "É permitido no máximo 3 arquivos de lista de presença.", 
            type: 'error' 
          });
          return;
        }
      }

      const newFiles: EvidenceFile[] = Array.from(files).map((file: any) => ({
        id: `FILE-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        name: file.name,
        uploadDate: new Date().toISOString(),
        // Armazena o Blob URL para permitir download durante a sessão mock
        base64: URL.createObjectURL(file)
      }));

      if (type === 'attendance') {
        onUpdate({ 
          ...data, 
          attendanceList: [...(data.attendanceList || []), ...newFiles] 
        });
      } else if (type === 'certificate') {
        onUpdate({ ...data, certificates: [...data.certificates, ...newFiles] });
      } else {
        onUpdate({ ...data, photos: [...data.photos, ...newFiles] });
      }
    };
    input.click();
  };

  const removeFile = (type: 'attendance' | 'certificate' | 'photo', id: string) => {
    if (type === 'attendance') {
      onUpdate({ ...data, attendanceList: (data.attendanceList || []).filter(f => f.id !== id) });
    } else if (type === 'certificate') {
      onUpdate({ ...data, certificates: data.certificates.filter(f => f.id !== id) });
    } else {
      onUpdate({ ...data, photos: data.photos.filter(f => f.id !== id) });
    }
  };

 const attendanceList = data.attendanceList || [];

// 🔹 Modalidade vem SEMPRE do treinamento
const isOnline = training?.modality === 'ONLINE';

const hasAttendance = attendanceList.length > 0;
const hasCertificates = data.certificates.length > 0;
const hasPhotos = data.photos.length > 0;

// 🔹 REGRA FINAL DE STATUS DE EVIDÊNCIA
// ONLINE → NÃO exige fotos
// PRESENCIAL / HÍBRIDO → exige fotos
const isComplete = isOnline
  ? (hasAttendance && hasCertificates)
  : (hasAttendance && hasCertificates && hasPhotos);

// Busca o nome do instrutor a partir do ID da demanda
  const instructorName = instructors.find(i => i.id === demand.instructorId)?.name || 'Instrutor não definido';

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 bg-white rounded-xl border border-slate-200 text-slate-400 hover:text-slate-600 transition-all shadow-sm"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-black text-slate-800 uppercase tracking-tight">Detalhamento de Evidências</h1>
            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-0.5 font-mono">Demanda #{demand.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mr-2">Status da Documentação:</span>
          {isComplete ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl shadow-lg shadow-emerald-900/10 animate-fade-in">
              <CheckCircle2 size={16} />
              <span className="text-[11px] font-black uppercase tracking-widest">Completa</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl shadow-lg shadow-amber-900/10">
              <Clock size={16} />
              <span className="text-[11px] font-black uppercase tracking-widest">Pendente</span>
            </div>
          )}
        </div>
      </div>

      {/* Info Demanda */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 grid grid-cols-1 md:grid-cols-5 gap-6">
          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Empresa</span>
            <div className="flex items-center gap-2">
              <Building2 size={14} className="text-slate-300" />
              <p className="text-sm font-bold text-slate-700">{company.name}</p>
            </div>
          </div>
          <div className="space-y-1 md:col-span-1">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Treinamento</span>
            <div className="flex items-center gap-2">
              <GraduationCap size={14} className="text-slate-300" />
              <p className="text-sm font-bold text-slate-700">{training.name}</p>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Instrutor</span>
            <div className="flex items-center gap-2">
              <User size={14} className="text-slate-300" />
              <p className="text-sm font-bold text-slate-700">{instructorName}</p>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Período</span>
            <div className="flex items-center gap-2">
              <CalendarIcon size={14} className="text-slate-300" />
              <p className="text-sm font-bold text-slate-700">{formatDateTime(demand.startDate)} - {formatDateTime(demand.endDate)}</p>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Local</span>
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-slate-300" />
              <p className="text-sm font-bold text-slate-700">{demand.trainingLocal || 'N/A'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bloco Lista de Presença */}
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-6 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <div className="flex flex-col">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <FileText size={16} className="text-blue-500" /> Lista de Presença
              </h3>
              <p className="text-[9px] text-slate-300 font-bold uppercase mt-1">{attendanceList.length}/3 arquivos</p>
            </div>
            <div className="flex gap-2">
              {attendanceList.length > 0 && (
                <button 
                  onClick={() => downloadAll(attendanceList)}
                  className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition flex items-center gap-2"
                >
                  <DownloadCloud size={14} /> Baixar todos
                </button>
              )}
              {attendanceList.length < 3 && (
                <button 
                  onClick={() => handleFileUpload('attendance')}
                  className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-100 transition"
                >
                  Adicionar Lista
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-2">
            {attendanceList.length > 0 ? attendanceList.map(file => (
              <div key={file.id} className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                    <CheckCircle2 size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-700 truncate max-w-[200px]">{file.name}</p>
                    <p className="text-[9px] font-medium text-slate-400 uppercase">Enviado em {formatDateTime(file.uploadDate)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button 
                    onClick={() => downloadFile(file)}
                    className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
                    title="Baixar arquivo"
                  >
                    <Download size={16} />
                  </button>
                  <button 
                    onClick={() => removeFile('attendance', file.id)}
                    className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                    title="Excluir arquivo"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )) : (
              <div className="h-24 border-2 border-dashed border-slate-100 rounded-2xl flex flex-col items-center justify-center text-slate-300 gap-2">
                <FilePlus size={24} className="opacity-50" />
                <p className="text-[10px] font-bold uppercase tracking-widest">Nenhuma lista anexada</p>
              </div>
            )}
          </div>
        </div>

        {/* Bloco Observações */}
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-6">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-6">
            <MessageSquare size={16} className="text-purple-500" /> Notas & Observações
          </h3>
          <textarea 
            className="w-full h-24 border border-slate-100 rounded-2xl p-4 text-xs font-medium text-slate-600 outline-none focus:ring-2 focus:ring-purple-100 resize-none bg-slate-50/50"
            placeholder="Digite notas relevantes sobre as evidências deste treinamento..."
            value={data.notes}
            onChange={(e) => onUpdate({ ...data, notes: e.target.value })}
          />
        </div>
      </div>

      {/* Bloco Certificados */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Award size={16} className="text-amber-500" /> Certificados Gerados
          </h3>
          <div className="flex gap-2">
            {data.certificates.length > 0 && (
              <button 
                onClick={() => downloadAll(data.certificates)}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition flex items-center gap-2"
              >
                <DownloadCloud size={14} /> Baixar todos
              </button>
            )}
            <button 
              onClick={() => handleFileUpload('certificate')}
              className="px-3 py-1.5 bg-amber-50 text-amber-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-amber-100 transition flex items-center gap-2"
            >
              <Upload size={14} /> Upload em Lote
            </button>
          </div>
        </div>

        {data.certificates.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.certificates.map(file => (
              <div key={file.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between group">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileText size={16} className="text-slate-400 shrink-0" />
                  <div className="overflow-hidden">
                    <p className="text-[11px] font-bold text-slate-700 truncate">{file.name}</p>
                    <p className="text-[9px] text-slate-400 uppercase">{formatDateTime(file.uploadDate)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button 
                    onClick={() => downloadFile(file)}
                    className="p-1 text-slate-300 hover:text-blue-600 transition-colors"
                    title="Baixar certificado"
                  >
                    <Download size={14} />
                  </button>
                  <button 
                    onClick={() => removeFile('certificate', file.id)}
                    className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                    title="Excluir certificado"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-slate-300 italic text-xs uppercase font-bold tracking-widest">
            Nenhum certificado carregado
          </div>
        )}
      </div>

          {/* Bloco Fotos — NÃO exibido para treinamentos ONLINE */}
          {!isOnline && (
            <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <ImageIcon size={16} className="text-emerald-500" /> Registros Fotográficos
                </h3>
                <div className="flex gap-2">
                  {data.photos.length > 0 && (
                    <button 
                      onClick={() => downloadAll(data.photos)}
                      className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition flex items-center gap-2"
                    >
                      <DownloadCloud size={14} /> Baixar todas
                    </button>
                  )}
                  <button 
                    onClick={() => handleFileUpload('photo')}
                    className="px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-100 transition flex items-center gap-2"
                  >
                    <ImagePlus size={14} /> Adicionar Fotos
                  </button>
                </div>
              </div>

              {data.photos.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {data.photos.map(photo => (
                    <div key={photo.id} className="relative aspect-square bg-slate-100 rounded-2xl border border-slate-200 overflow-hidden group shadow-sm">
                      <div className="absolute inset-0 flex items-center justify-center text-slate-300">
                        {photo.base64 ? (
                          <img src={photo.base64} alt={photo.name} className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon size={32} strokeWidth={1} />
                        )}
                      </div>
                      <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <button 
                          onClick={() => downloadFile(photo)}
                          className="p-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition shadow-sm"
                          title="Baixar foto"
                        >
                          <Download size={16} />
                        </button>
                        <button 
                          onClick={() => removeFile('photo', photo.id)}
                          className="p-2 bg-red-500 text-white rounded-xl hover:bg-red-600 transition shadow-sm"
                          title="Excluir foto"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 p-2 bg-white/90 backdrop-blur-sm border-t border-slate-100">
                        <p className="text-[8px] font-black text-slate-600 truncate">{photo.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-slate-300 italic text-xs uppercase font-bold tracking-widest">
                  Nenhuma foto disponível
                </div>
              )}
            </div>
          )}
    </div>
  );
};

export default EvidenceDetails;
