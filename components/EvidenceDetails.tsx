import React from 'react';
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
  User,
  Tag
} from 'lucide-react';
import { Demand, Company, Training, EvidenceData, EvidenceFile } from '../types';
import { useApp } from '../App';
import { supabase } from '../lib/supabase';

const EVIDENCES_BUCKET = 'evidences';

interface EvidenceDetailsProps {
  demand: Demand;
  company: Company;
  training: Training;
  data: EvidenceData;
  onBack: () => void;
  onUpdate: (updatedData: EvidenceData) => void;
  onSaveNotes: (notes: string) => Promise<void>;
}

const EvidenceDetails: React.FC<EvidenceDetailsProps> = ({
  demand,
  company,
  training,
  data,
  onBack,
  onUpdate,
  onSaveNotes
}) => {

  const { setNotification, instructors } = useApp();

  // ✅ safeData DENTRO do componente
  const safeData: EvidenceData = data ?? {
    demandId: demand.id,
    attendanceList: [],
    certificates: [],
    photos: [],
    notes: ''
  };

  const [notes, setNotes] = React.useState(safeData.notes || '');

  React.useEffect(() => {
    setNotes(safeData.notes || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.demandId]); // ou [demand.id]

  // ✅ Cache de signed URLs para preview (principalmente fotos)
  const [signedUrlByFileId, setSignedUrlByFileId] = React.useState<Record<string, string>>({});

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '---';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('pt-BR');
  };

  const uploadToStorage = async (
    type: 'attendance' | 'certificate' | 'photo',
    file: File
  ): Promise<EvidenceFile> => {
    const safeName = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `demands/${demand.id}/${type}/${Date.now()}_${safeName}`;

    const { error } = await supabase.storage
      .from(EVIDENCES_BUCKET)
      .upload(path, file, {
        upsert: false,
        contentType: file.type || undefined
      });

    if (error) throw error;

    return {
      id: `FILE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      uploadDate: new Date().toISOString(),
      storagePath: path,
      mimeType: file.type || undefined,
      size: file.size || undefined
      // url é opcional (se existir no seu type)
    } as EvidenceFile;
  };

  // ✅ Gera signed URL e guarda em cache (bom para preview e também pode ser usado no download)
  const getSignedUrlCached = React.useCallback(
    async (file: EvidenceFile, expiresInSeconds = 60 * 30) => {
      // Se já tiver url no objeto, usa ela
      // (Mas ainda pode abrir inline; para download, vamos usar blob de qualquer jeito)
      if ((file as any).url) return (file as any).url as string;

      // Se já tiver cache, retorna
      if (signedUrlByFileId[file.id]) return signedUrlByFileId[file.id];

      if (!file.storagePath) return '';

      const { data, error } = await supabase.storage
        .from(EVIDENCES_BUCKET)
        .createSignedUrl(file.storagePath, expiresInSeconds);

      if (error || !data?.signedUrl) {
        console.error(error);
        return '';
      }

      setSignedUrlByFileId(prev => ({ ...prev, [file.id]: data.signedUrl }));
      return data.signedUrl;
    },
    [signedUrlByFileId]
  );

  // ✅ FORÇA DOWNLOAD (não abre imagem no navegador)
  const downloadFile = async (file: EvidenceFile) => {
    try {
      let url = await getSignedUrlCached(file, 60); // 60s para download

      if (!url) {
        setNotification({ message: 'Não foi possível obter URL para download.', type: 'error' });
        return;
      }

      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Falha ao baixar arquivo: ${resp.status}`);

      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = file.name || 'arquivo';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    } catch (e) {
      console.error(e);
      setNotification({ message: 'Erro ao baixar arquivo.', type: 'error' });
    }
  };

  // ✅ Baixar todos (com delay maior para reduzir bloqueio do Chrome)
  const downloadAll = (files: EvidenceFile[]) => {
    if (!files?.length) return;
    files.forEach((file, index) => {
      setTimeout(() => downloadFile(file), index * 600);
    });
  };

  // ✅ Pré-carregar signed URLs das fotos para preview
  React.useEffect(() => {
    const run = async () => {
      try {
        const photos = safeData.photos || [];
        const missing = photos.filter(p => !(p as any).url && p.storagePath && !signedUrlByFileId[p.id]);
        if (!missing.length) return;

        const results = await Promise.all(
          missing.map(async p => {
            const { data, error } = await supabase.storage
              .from(EVIDENCES_BUCKET)
              .createSignedUrl(p.storagePath, 60 * 30); // 30 min preview
            if (error || !data?.signedUrl) return null;
            return { id: p.id, url: data.signedUrl };
          })
        );

        const next: Record<string, string> = {};
        results.filter(Boolean).forEach((r: any) => (next[r.id] = r.url));
        if (Object.keys(next).length) setSignedUrlByFileId(prev => ({ ...prev, ...next }));
      } catch (e) {
        console.error(e);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeData.photos]);

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

    input.onchange = async (e: any) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      // Regra: lista de presença no máximo 3
      if (type === 'attendance') {
        const currentCount = (safeData.attendanceList || []).length;
        if (currentCount + files.length > 3) {
          setNotification({
            message: 'É permitido no máximo 3 arquivos de lista de presença.',
            type: 'error'
          });
          return;
        }
      }

      const selectedFiles = Array.from(files) as File[];

      try {
        const uploaded = await Promise.all(selectedFiles.map(f => uploadToStorage(type, f)));

        if (type === 'attendance') {
          onUpdate({
            ...safeData,
            attendanceList: [...(safeData.attendanceList || []), ...uploaded]
          });
        } else if (type === 'certificate') {
          onUpdate({
            ...safeData,
            certificates: [...(safeData.certificates || []), ...uploaded]
          });
        } else {
          onUpdate({
            ...safeData,
            photos: [...(safeData.photos || []), ...uploaded]
          });
        }

        setNotification({ message: 'Arquivos enviados com sucesso.', type: 'success' });
      } catch (err) {
        console.error(err);
        setNotification({ message: 'Erro ao enviar arquivos.', type: 'error' });
      } finally {
        input.value = '';
      }
    };

    input.click();
  };

 const removeFile = async (
  type: 'attendance' | 'certificate' | 'photo',
  id: string
) => {
  try {
    const list =
      type === 'attendance'
        ? safeData.attendanceList || []
        : type === 'certificate'
        ? safeData.certificates || []
        : safeData.photos || [];

    const file = list.find(f => f.id === id);

    if (!file) {
      setNotification({ message: 'Arquivo não encontrado.', type: 'error' });
      return;
    }

    // 🔥 REMOVE DO STORAGE
    if (file.storagePath) {
      const { error } = await supabase.storage
        .from(EVIDENCES_BUCKET)
        .remove([file.storagePath]);

      if (error) {
        console.error(error);
        setNotification({
          message: 'Erro ao excluir arquivo no storage.',
          type: 'error'
        });
        return;
      }
    }

    // 🔄 REMOVE DO FRONT
    if (type === 'attendance') {
      onUpdate({
        ...safeData,
        attendanceList: list.filter(f => f.id !== id)
      });
    } else if (type === 'certificate') {
      onUpdate({
        ...safeData,
        certificates: list.filter(f => f.id !== id)
      });
    } else {
      onUpdate({
        ...safeData,
        photos: list.filter(f => f.id !== id)
      });
    }

    setNotification({
      message: 'Arquivo excluído com sucesso.',
      type: 'success'
    });
  } catch (e) {
    console.error(e);
    setNotification({
      message: 'Erro ao excluir arquivo.',
      type: 'error'
    });
  }
};


  const attendanceList = safeData.attendanceList || [];

  // Modalidade vem SEMPRE do treinamento
  const isOnline = String(training?.modality ?? '').toUpperCase() === 'ONLINE';

  const hasAttendance = attendanceList.length > 0;
  const hasCertificates = (safeData.certificates || []).length > 0;
  const hasPhotos = (safeData.photos || []).length > 0;

  // ONLINE → NÃO exige fotos | PRESENCIAL/HÍBRIDO → exige fotos
  const isComplete = isOnline
    ? hasAttendance && hasCertificates
    : hasAttendance && hasCertificates && hasPhotos;

  const instructorName =
    instructors.find(i => i.id === demand.instructorId)?.name || 'Instrutor não definido';

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
            <h1 className="text-xl font-black text-slate-800 uppercase tracking-tight">
              Detalhamento de Evidências
            </h1>
            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-0.5 font-mono">
              Demanda #{demand.id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mr-2">
            Status da Documentação:
          </span>
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
        <div className={`p-6 grid grid-cols-1 gap-6 ${demand.clientDemandId ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
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
              <p className="text-sm font-bold text-slate-700">
                {formatDateTime(demand.startDate)} - {formatDateTime(demand.endDate)}
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Local</span>
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-slate-300" />
              <p className="text-sm font-bold text-slate-700">{demand.trainingLocal || 'N/A'}</p>
            </div>
          </div>

          {demand.clientDemandId && (
            <div className="space-y-1">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">ID SAP / Pedido</span>
              <div className="flex items-center gap-2">
                <Tag size={14} className="text-slate-300" />
                <p className="text-sm font-bold text-slate-700">{demand.clientDemandId}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lista de Presença */}
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-6 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <div className="flex flex-col">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <FileText size={16} className="text-blue-500" /> Lista de Presença
              </h3>
              <p className="text-[9px] text-slate-300 font-bold uppercase mt-1">
                {attendanceList.length}/3 arquivos
              </p>
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
            {attendanceList.length > 0 ? (
              attendanceList.map(file => (
                <div
                  key={file.id}
                  className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                      <CheckCircle2 size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-700 truncate max-w-[200px]">{file.name}</p>
                      <p className="text-[9px] font-medium text-slate-400 uppercase">
                        Enviado em {formatDateTime(file.uploadDate)}
                      </p>
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
              ))
            ) : (
              <div className="h-24 border-2 border-dashed border-slate-100 rounded-2xl flex flex-col items-center justify-center text-slate-300 gap-2">
                <FilePlus size={24} className="opacity-50" />
                <p className="text-[10px] font-bold uppercase tracking-widest">Nenhuma lista anexada</p>
              </div>
            )}
          </div>
        </div>

        {/* Observações */}
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-6">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-6">
            <MessageSquare size={16} className="text-purple-500" /> Notas & Observações
          </h3>
          <textarea
            className="w-full h-24 border border-slate-100 rounded-2xl p-4 text-xs font-medium text-slate-600 outline-none focus:ring-2 focus:ring-purple-100 resize-none bg-slate-50/50"
            placeholder="Digite notas relevantes sobre as evidências deste treinamento..."
            value={notes}
          onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {/* Certificados */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Award size={16} className="text-amber-500" /> Certificados Gerados
          </h3>
          <div className="flex gap-2">
            {(safeData.certificates || []).length > 0 && (
              <button
                onClick={() => downloadAll(safeData.certificates || [])}
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

        {(safeData.certificates || []).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(safeData.certificates || []).map(file => (
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

      {/* Fotos — NÃO exibido para ONLINE */}
      {!isOnline && (
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <ImageIcon size={16} className="text-emerald-500" /> Registros Fotográficos
            </h3>
            <div className="flex gap-2">
              {(safeData.photos || []).length > 0 && (
                <button
                  onClick={() => downloadAll(safeData.photos || [])}
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

          {(safeData.photos || []).length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {(safeData.photos || []).map(photo => {
                const src = (photo as any).url || signedUrlByFileId[photo.id];

                return (
                  <div
                    key={photo.id}
                    className="relative aspect-square bg-slate-100 rounded-2xl border border-slate-200 overflow-hidden group shadow-sm"
                  >
                    <div className="absolute inset-0 flex items-center justify-center text-slate-300">
                      {src ? (
                        <img src={src} alt={photo.name} className="w-full h-full object-cover" />
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
                );
              })}
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
