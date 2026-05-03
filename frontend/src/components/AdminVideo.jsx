import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  FileVideo,
  Loader2,
  Play,
  RefreshCw,
  Signal,
  UploadCloud,
  XCircle
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { adminService, parkingService, videoService } from '../services/api';
import LoadingSpinner from './LoadingSpinner';
import { formatTime, formatDuration } from '../utils/dateUtils';

const getMetadata = (lot) => lot?.slot_configuration?.metadata || {};

const getLotStats = (lot) => {
  const stats = lot?.statistics || {};
  const total = Number(stats.total_slots ?? lot?.total_slots ?? 0);
  const occupied = Number(stats.occupied_slots ?? 0);
  const available = Number(stats.available_slots ?? Math.max(total - occupied, 0));
  const occupancy = Number(stats.occupancy_rate ?? (total > 0 ? (occupied / total) * 100 : 0));

  return {
    total,
    occupied,
    available,
    occupancy: Number.isFinite(occupancy) ? Math.round(occupancy * 10) / 10 : 0
  };
};

const getAnalysisData = (analysis) => {
  if (!analysis?.analysis_data) return {};
  if (typeof analysis.analysis_data === 'string') {
    try {
      return JSON.parse(analysis.analysis_data);
    } catch (_) {
      return {};
    }
  }
  return analysis.analysis_data;
};

const getAnalysisMetrics = (analysis) => {
  const data = getAnalysisData(analysis);
  const detections = Array.isArray(data.slot_detections) ? data.slot_detections : [];
  const occupied = detections.filter((slot) => slot.is_occupied).length;
  const vacant = detections.length > 0 ? detections.length - occupied : null;
  const averageConfidence = detections.length > 0
    ? detections.reduce((sum, slot) => sum + Number(slot.confidence || 0), 0) / detections.length
    : Number(data.confidence_scores?.overall || 0);

  return {
    detections,
    total: detections.length || Number(data.total_slots || 0),
    occupied: detections.length > 0 ? occupied : Number(data.vehicle_count || 0),
    vacant,
    occupancyRate: detections.length > 0 ? Math.round((occupied / detections.length) * 1000) / 10 : Number(data.occupancy_rate || 0),
    averageConfidence: Number.isFinite(averageConfidence) ? averageConfidence : 0,
    inferenceEventId: data.inference_event_id,
    standardInferenceResult: data.standard_inference_result
  };
};

const getJobMetadata = (job) => {
  if (!job?.metadata) return {};
  if (typeof job.metadata === 'string') {
    try {
      return JSON.parse(job.metadata);
    } catch (_) {
      return {};
    }
  }
  return job.metadata;
};

const statusLabels = {
  pending: '等待处理',
  processing: '识别中',
  completed: '已完成',
  failed: '失败'
};

const statusTone = {
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  processing: 'border-blue-200 bg-blue-50 text-blue-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-red-200 bg-red-50 text-red-700'
};

const jobStatusLabels = {
  queued: '排队中',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

const jobStatusTone = {
  queued: 'border-amber-200 bg-amber-50 text-amber-700',
  processing: 'border-blue-200 bg-blue-50 text-blue-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
  cancelled: 'border-zinc-200 bg-zinc-100 text-zinc-600'
};

const jobTypeLabels = {
  image: '图片识别',
  video_file: '视频文件',
  dataset_batch: '数据集批处理',
  manual_demo: '演示任务',
  api_inference: 'API 写回'
};

const sourceLabels = {
  campus_demo: '校园试点 demo',
  campus_camera: '校园样例视频',
  beijing_open_data_demo: '北京开放数据样例',
  ai_dataset_demo: 'AI 数据集验证',
  demo: '演示数据'
};

const trainingDatasetEvidence = [
  {
    key: 'acpds',
    name: 'ACPDS',
    status: '已训练',
    samples: '11,236 个车位实例',
    license: 'MIT',
    path: 'datasets/raw/acpds/rois_gopro.zip',
    metric: 'test accuracy 0.8919',
  },
  {
    key: 'cnrpark_ext',
    name: 'CNRPark+EXT',
    status: '30k 训练已完成',
    samples: '约 150,000 张车位 patch',
    license: 'ODbL v1.0',
    path: 'datasets/raw/cnrpark_ext/CNR-EXT-Patches-150x150.zip',
    metric: '30,000 样本 epoch3 accuracy 0.9718 / occupied F1 0.9740',
  },
  {
    key: 'pklot',
    name: 'PKLot',
    status: '样例已登记',
    samples: '12,416 张图 / 约 695,900 个车位实例',
    license: 'CC BY 4.0',
    path: 'datasets/samples/pklot_hf',
    metric: '用于跨天气泛化验证',
  },
];

const evidenceToneStyles = {
  emerald: {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500'
  },
  blue: {
    border: 'border-blue-200',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    dot: 'bg-blue-500'
  }
};

const isCampusSampleJob = (job) => {
  const metadata = getJobMetadata(job);
  const modelName = `${job?.model_name || ''}`.toLowerCase();
  const inputSource = `${metadata.input_source || job?.input_path || ''}`.toLowerCase();
  const lotName = `${job?.parking_lot_name || ''}`;

  return metadata.source === 'demo_ai_model_infer'
    && (
      modelName.includes('campus')
      || inputSource.includes('/campus/')
      || inputSource.includes('campus')
      || lotName.includes('校园')
    );
};

const isPublicDatasetJob = (job) => {
  const metadata = getJobMetadata(job);
  return metadata.source === 'demo_ai_model_infer' && !isCampusSampleJob(job);
};

const EvidenceChainCard = ({ title, description, job, metadata, emptyText, tone = 'emerald' }) => {
  const styles = evidenceToneStyles[tone] || evidenceToneStyles.emerald;
  const totalSlots = Number(metadata.total_slots || job?.inference_total_slots || 0);
  const occupiedCount = Number(metadata.occupied_count || job?.inference_occupied_count || 0);
  const vacantCount = Number(metadata.vacant_count || job?.inference_vacant_count || 0);
  const confidence = Number(metadata.average_confidence || job?.inference_average_confidence || 0);

  return (
    <article className={`rounded-lg border ${styles.border} bg-white p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${styles.dot}`} />
            <h3 className="font-semibold text-zinc-950">{title}</h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p>
        </div>
        <span className={`flex-none rounded-full border px-2 py-0.5 text-xs font-medium ${styles.border} ${styles.bg} ${styles.text}`}>
          {job ? '已写回' : '待验证'}
        </span>
      </div>

      {job ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-zinc-500">任务 / 事件</p>
            <p className="mt-1 text-sm font-semibold text-zinc-950">
              #{job.id}
              {job.result_inference_event_id ? ` / #${job.result_inference_event_id}` : ' / 未写回'}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">模型版本</p>
            <p className="mt-1 break-words text-sm font-semibold text-zinc-950">{job.model_name || '待记录'}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">ROI 与结果</p>
            <p className="mt-1 text-sm font-semibold text-zinc-950">
              {totalSlots} 车位 · {occupiedCount} 占用 / {vacantCount} 空闲
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">平均置信度</p>
            <p className="mt-1 text-sm font-semibold text-zinc-950">
              {confidence ? `${(confidence * 100).toFixed(1)}%` : '暂无'}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs text-zinc-500">输入来源</p>
            <p className="mt-1 break-all text-sm text-zinc-800">{metadata.input_source || job.input_path || '未记录'}</p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              停车场：{job.parking_lot_name || `#${job.parking_lot_id || '-'}`} · ROI 数量 {metadata.roi_count || totalSlots || '-'} · {formatTimestamp(job.created_at)}
            </p>
          </div>
        </div>
      ) : (
        <div className={`mt-5 rounded-md border ${styles.border} ${styles.bg} px-4 py-3 text-sm leading-6 ${styles.text}`}>
          {emptyText}
        </div>
      )}
    </article>
  );
};

const EvidenceSummaryCard = ({ label, job, metadata, fallback, tone = 'emerald' }) => {
  const styles = evidenceToneStyles[tone] || evidenceToneStyles.emerald;
  const totalSlots = Number(metadata.total_slots || job?.inference_total_slots || fallback?.totalSlots || 0);
  const occupiedCount = Number(metadata.occupied_count || job?.inference_occupied_count || fallback?.occupiedCount || 0);
  const confidence = Number(metadata.average_confidence || job?.inference_average_confidence || fallback?.confidence || 0);

  return (
    <article className={`rounded-xl border ${styles.border} ${styles.bg} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold ${styles.text}`}>{label}</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-950">
            {job ? '已形成写回证据' : fallback?.title || '等待验证'}
          </h2>
        </div>
        <span className={`rounded-full bg-white/75 px-2 py-0.5 text-xs font-semibold ${styles.text}`}>
          {job ? `任务 #${job.id}` : '未写回'}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-white/70 p-2">
          <p className="text-xs text-zinc-500">ROI/车位</p>
          <p className="mt-1 font-semibold text-zinc-950">{totalSlots || '--'}</p>
        </div>
        <div className="rounded-lg bg-white/70 p-2">
          <p className="text-xs text-zinc-500">占用写回</p>
          <p className="mt-1 font-semibold text-zinc-950">{occupiedCount || '--'}</p>
        </div>
        <div className="rounded-lg bg-white/70 p-2">
          <p className="text-xs text-zinc-500">置信度</p>
          <p className="mt-1 font-semibold text-zinc-950">{confidence ? `${(confidence * 100).toFixed(1)}%` : '--'}</p>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-zinc-600">
        {job
          ? `${job.model_name || 'AI 模型'} · 事件 ${job.result_inference_event_id ? `#${job.result_inference_event_id}` : '未关联'} · ${formatTimestamp(job.created_at)}`
          : fallback?.detail || '完成推理后会显示任务、事件和车位写回结果。'}
      </p>
    </article>
  );
};

const EvidenceFlowPanel = ({ campusJob, campusMetadata, publicJob, publicMetadata, latestEvent }) => {
  const campusSlots = Number(campusMetadata.total_slots || campusJob?.inference_total_slots || 0);
  const campusOccupied = Number(campusMetadata.occupied_count || campusJob?.inference_occupied_count || 0);
  const publicSlots = Number(publicMetadata.total_slots || publicJob?.inference_total_slots || 0);
  const latestEventId = latestEvent?.id || campusJob?.result_inference_event_id || publicJob?.result_inference_event_id;
  const latestLotName = latestEvent?.parking_lot_name || campusJob?.parking_lot_name || publicJob?.parking_lot_name || '待写回停车场';

  const steps = [
    {
      label: '训练证据',
      title: 'CNRPark+EXT 30k',
      value: 'Acc 97.18%',
      detail: 'occupied F1 0.9740',
      icon: Database,
      tone: 'blue'
    },
    {
      label: '校园样例',
      title: campusJob ? `任务 #${campusJob.id}` : '待运行',
      value: campusSlots ? `${campusSlots} ROI` : '24 ROI',
      detail: campusJob ? `${campusOccupied} 个车位写回占用` : '运行校园样例验证后生成',
      icon: Camera,
      tone: 'emerald'
    },
    {
      label: '标准事件',
      title: latestEventId ? `事件 #${latestEventId}` : '待关联',
      value: latestEventId ? '已入库' : '未写回',
      detail: latestLotName,
      icon: Signal,
      tone: 'violet'
    },
    {
      label: '余位服务',
      title: '用户端同步',
      value: campusJob || publicJob ? '可展示' : '待验证',
      detail: campusJob || publicJob ? '停车余位、可停概率和 Plan B 可随事件变化' : '缺少 AI 事件时仅展示静态样例',
      icon: CheckCircle2,
      tone: 'amber'
    }
  ];

  const toneClassName = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    violet: 'border-violet-200 bg-violet-50 text-violet-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700'
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
        <div className="border-b border-zinc-100 bg-zinc-950 px-5 py-5 text-white lg:border-b-0 lg:border-r lg:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">AI Evidence Flow</p>
          <h2 className="mt-2 text-2xl font-semibold leading-tight">从训练到余位写回</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            评委可以按这条链路理解：公开数据集训练模型，校园样例做 ROI 推理，生成标准事件，再同步到用户端停车决策。
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-white/10 p-3">
              <p className="text-lg font-semibold text-white">{publicSlots || 98}</p>
              <p className="mt-1 text-zinc-400">公开 ROI</p>
            </div>
            <div className="rounded-xl bg-white/10 p-3">
              <p className="text-lg font-semibold text-white">{campusSlots || 24}</p>
              <p className="mt-1 text-zinc-400">校园 ROI</p>
            </div>
            <div className="rounded-xl bg-white/10 p-3">
              <p className="text-lg font-semibold text-white">{latestEventId ? `#${latestEventId}` : '--'}</p>
              <p className="mt-1 text-zinc-400">最新事件</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <article key={step.label} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border ${toneClassName[step.tone]}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-semibold text-zinc-400">0{index + 1}</span>
                </div>
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{step.label}</p>
                <h3 className="mt-1 text-sm font-semibold text-zinc-950">{step.title}</h3>
                <p className="mt-2 text-xl font-semibold text-zinc-950">{step.value}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{step.detail}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

const LatestWritebackImpactPanel = ({ job, metadata = {}, latestEvent, lots = [] }) => {
  const eventId = job?.result_inference_event_id || latestEvent?.id;
  const lotId = job?.parking_lot_id || latestEvent?.parking_lot_id;
  const matchedLot = lots.find((lot) => String(lot.id) === String(lotId)) || null;
  const stats = matchedLot ? getLotStats(matchedLot) : null;
  const lotName = job?.parking_lot_name || latestEvent?.parking_lot_name || matchedLot?.name || '待关联停车场';
  const totalSlots = Number(metadata.total_slots || job?.inference_total_slots || latestEvent?.total_slots || stats?.total || 0);
  const occupiedCount = Number(metadata.occupied_count || job?.inference_occupied_count || latestEvent?.occupied_slots || 0);
  const vacantCount = Number(metadata.vacant_count || job?.inference_vacant_count || Math.max(totalSlots - occupiedCount, 0));
  const confidence = Number(metadata.average_confidence || job?.inference_average_confidence || latestEvent?.average_confidence || 0);
  const beforeAvailable = metadata.before_available ?? latestEvent?.before_available;
  const afterAvailable = metadata.after_available ?? latestEvent?.after_available ?? stats?.available;
  const hasEvidence = Boolean(job || latestEvent);

  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/60 shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <div className="border-b border-emerald-100 bg-white px-5 py-5 lg:border-b-0 lg:border-r">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Latest Writeback Impact</p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-950">最近一次写回影响</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            这一块把任务、事件和用户端余位变化放在一起看，避免评委误解为静态展示。
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800">
              {hasEvidence ? '已形成证据链' : '等待 AI 写回'}
            </span>
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-semibold text-zinc-600">
              {eventId ? `事件 #${eventId}` : '暂无事件'}
            </span>
          </div>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-3 xl:grid-cols-6">
          {[
            { label: '停车场', value: lotName, detail: job?.id ? `任务 #${job.id}` : '任务待关联', wide: true },
            { label: 'ROI 数', value: totalSlots || '--', detail: '识别车位' },
            { label: '占用 / 空闲', value: `${occupiedCount || '--'} / ${vacantCount || '--'}`, detail: '写回状态' },
            { label: '平均置信度', value: confidence ? `${(confidence * 100).toFixed(1)}%` : '--', detail: job?.model_name || '模型待记录' },
            {
              label: '余位变化',
              value: beforeAvailable !== undefined && afterAvailable !== undefined ? `${beforeAvailable} → ${afterAvailable}` : (afterAvailable !== undefined ? `${afterAvailable}` : '--'),
              detail: beforeAvailable !== undefined ? '写回前后' : '当前用户端余位'
            },
            { label: '同步说明', value: hasEvidence ? '可同步' : '待运行', detail: '影响余位与可停概率' }
          ].map((item) => (
            <article key={item.label} className={`rounded-xl border border-white/80 bg-white p-3 shadow-sm ${item.wide ? 'sm:col-span-2 xl:col-span-2' : ''}`}>
              <p className="text-xs font-medium text-zinc-500">{item.label}</p>
              <p className="mt-1 truncate text-lg font-semibold text-zinc-950">{item.value}</p>
              <p className="mt-1 truncate text-xs text-zinc-500">{item.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

const formatTimestamp = (value) => {
  if (!value) return '暂无记录';

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
};

const AdminVideo = () => {
  const [analyses, setAnalyses] = useState([]);
  const [lots, setLots] = useState([]);
  const [queue, setQueue] = useState(null);
  const [inferenceEvents, setInferenceEvents] = useState([]);
  const [aiProcessingJobs, setAiProcessingJobs] = useState([]);
  const [aiJobSummary, setAiJobSummary] = useState({});
  const [jobStatusFilter, setJobStatusFilter] = useState('all');
  const [selectedLotId, setSelectedLotId] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [expandedAnalysisId, setExpandedAnalysisId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [runningDemo, setRunningDemo] = useState(false);
  const [runningModelInference, setRunningModelInference] = useState(false);
  const [runningCampusInference, setRunningCampusInference] = useState(false);
  const [rerunningJobId, setRerunningJobId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadWorkbench = async ({ showRefreshing = false } = {}) => {
    if (showRefreshing) setRefreshing(true);
    setLoading((current) => current || !showRefreshing);
    setError('');

    try {
      const [lotsResponse, analysesResponse, queueResponse, inferenceResponse, aiJobsResponse] = await Promise.all([
        parkingService.getAllParkingLots(),
        videoService.getRecentAnalyses(50),
        videoService.getProcessingQueue(),
        adminService.getInferenceEvents({ limit: 20 }),
        adminService.getAiProcessingJobs({ limit: 50 })
      ]);

      const nextLots = lotsResponse.data?.data?.parking_lots || lotsResponse.data?.data || [];
      setLots(nextLots);
      setSelectedLotId((current) => current || (nextLots[0] ? String(nextLots[0].id) : ''));
      setAnalyses(analysesResponse.data?.data?.analyses || []);
      setQueue(queueResponse.data?.data || null);
      setInferenceEvents(inferenceResponse.data?.data?.inference_events || []);
      setAiProcessingJobs(aiJobsResponse.data?.data?.ai_processing_jobs || []);
      setAiJobSummary(aiJobsResponse.data?.data?.summary || {});
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || 'AI 识别工作台加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadWorkbench();
  }, []);

  const selectedLot = useMemo(() => (
    lots.find((lot) => String(lot.id) === String(selectedLotId)) || null
  ), [lots, selectedLotId]);

  const selectedLotStats = selectedLot ? getLotStats(selectedLot) : { total: 0, occupied: 0, available: 0, occupancy: 0 };
  const selectedMetadata = getMetadata(selectedLot);

  const latestCompletedAnalysis = useMemo(() => (
    analyses.find((analysis) => analysis.processing_status === 'completed') || null
  ), [analyses]);

  const latestInferenceEvent = inferenceEvents[0] || null;
  const pendingCount = queue?.queue?.pending ?? analyses.filter((analysis) => analysis.processing_status === 'pending').length;
  const processingCount = queue?.queue?.processing ?? analyses.filter((analysis) => analysis.processing_status === 'processing').length;
  const completedCount = analyses.filter((analysis) => analysis.processing_status === 'completed').length;
  const failedCount = analyses.filter((analysis) => analysis.processing_status === 'failed').length;
  const activeAiJobCount = Number(aiJobSummary.queued || 0) + Number(aiJobSummary.processing || 0);
  const failedAiJobCount = Number(aiJobSummary.failed || 0);
  const latestAiJob = aiProcessingJobs[0] || null;
  const latestCampusInferenceJob = useMemo(() => (
    aiProcessingJobs.find(isCampusSampleJob) || null
  ), [aiProcessingJobs]);
  const latestCampusInferenceMetadata = getJobMetadata(latestCampusInferenceJob);
  const latestPublicDatasetInferenceJob = useMemo(() => (
    aiProcessingJobs.find(isPublicDatasetJob) || null
  ), [aiProcessingJobs]);
  const latestPublicDatasetInferenceMetadata = getJobMetadata(latestPublicDatasetInferenceJob);
  const latestEvidenceJob = latestCampusInferenceJob || latestPublicDatasetInferenceJob || latestAiJob;
  const latestEvidenceMetadata = latestCampusInferenceJob
    ? latestCampusInferenceMetadata
    : latestPublicDatasetInferenceJob
      ? latestPublicDatasetInferenceMetadata
      : getJobMetadata(latestAiJob);

  const filteredAiJobs = useMemo(() => {
    if (jobStatusFilter === 'all') return aiProcessingJobs;
    return aiProcessingJobs.filter((job) => job.status === jobStatusFilter);
  }, [aiProcessingJobs, jobStatusFilter]);
  const hasHistoricInferenceWithoutJobs = aiProcessingJobs.length === 0 && inferenceEvents.length > 0;

  const handleRefresh = async () => {
    await loadWorkbench({ showRefreshing: true });
    toast.success('AI 识别工作台已刷新');
  };

  const handleUpload = async () => {
    if (!selectedLotId) {
      toast.error('请先选择停车场');
      return;
    }
    if (!selectedFile) {
      toast.error('请先选择样例视频文件');
      return;
    }

    setUploading(true);
    setError('');

    try {
      const form = new FormData();
      form.append('video', selectedFile);
      form.append('parking_lot_id', selectedLotId);
      form.append('analysis_type', 'full');

      await videoService.uploadVideo(form);
      toast.success('样例视频已上传，识别任务已进入队列');
      setSelectedFile(null);
      await loadWorkbench({ showRefreshing: true });
    } catch (requestError) {
      const message = requestError.response?.data?.message || requestError.response?.data?.error || requestError.message || '视频上传失败';
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const handleRunDemo = async () => {
    if (!selectedLotId) {
      toast.error('请先选择停车场');
      return;
    }

    setRunningDemo(true);
    setError('');

    try {
      await videoService.testVideoProcessing(selectedLotId);
      toast.success('演示识别任务已启动，约 2 秒后写入 AI 事件');
      setTimeout(() => {
        loadWorkbench({ showRefreshing: true });
      }, 2600);
    } catch (requestError) {
      const message = requestError.response?.data?.message || requestError.response?.data?.error || requestError.message || '演示识别启动失败';
      setError(message);
      toast.error(message);
    } finally {
      setRunningDemo(false);
    }
  };

  const handleRunModelInference = async () => {
    setRunningModelInference(true);
    setError('');

    try {
      const response = await adminService.runDemoAiInference({
        config_path: 'data/demo_ai_inference_config_cnrpark.json'
      });
      const summary = response.data?.data?.summary;
      const detail = summary
        ? `模型推理完成：${summary.total_slots} 个 ROI，${summary.occupied_count} 占用 / ${summary.vacant_count} 空闲`
        : '公开数据集模型推理已完成';
      toast.success(detail);
      await loadWorkbench({ showRefreshing: true });
    } catch (requestError) {
      const message = requestError.response?.data?.message || requestError.response?.data?.error || requestError.message || '模型推理运行失败';
      setError(message);
      toast.error(message);
    } finally {
      setRunningModelInference(false);
    }
  };

  const handleRunCampusInference = async () => {
    setRunningCampusInference(true);
    setError('');

    try {
      const response = await adminService.runDemoAiInference({
        config_path: 'data/demo_ai_inference_config_campus_synthetic.json'
      });
      const summary = response.data?.data?.summary;
      const detail = summary
        ? `校园样例验证完成：${summary.total_slots} 个 ROI，${summary.occupied_count} 占用 / ${summary.vacant_count} 空闲`
        : '校园样例模型推理已完成';
      toast.success(detail);
      await loadWorkbench({ showRefreshing: true });
    } catch (requestError) {
      const message = requestError.response?.data?.message || requestError.response?.data?.error || requestError.message || '校园样例验证失败';
      setError(message);
      toast.error(message);
    } finally {
      setRunningCampusInference(false);
    }
  };

  const cancelProcessing = async (analysisId) => {
    try {
      await videoService.cancelAnalysis(analysisId);
      toast.success('已取消等待中的识别任务');
      await loadWorkbench({ showRefreshing: true });
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || '取消失败');
    }
  };

  const cancelAiJob = async (jobId) => {
    try {
      await adminService.updateAiProcessingJobStatus(jobId, {
        status: 'cancelled',
        metadata: {
          cancelled_from: 'admin_video_workbench',
          cancelled_at: new Date().toISOString()
        }
      });
      toast.success('AI 任务已取消');
      await loadWorkbench({ showRefreshing: true });
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'AI 任务取消失败');
    }
  };

  const rerunAiJob = async (jobId) => {
    setRerunningJobId(jobId);
    setError('');

    try {
      const response = await adminService.rerunAiProcessingJob(jobId);
      const summary = response.data?.data?.summary;
      const detail = summary
        ? `更新 ${summary.total_slots} 个车位：${summary.occupied_count} 占用 / ${summary.vacant_count} 空闲`
        : '已完成一次 demo 任务重跑';
      toast.success(detail);
      await loadWorkbench({ showRefreshing: true });
    } catch (requestError) {
      const message = requestError.response?.data?.message || requestError.response?.data?.error || requestError.message || 'AI 任务重跑失败';
      setError(message);
      toast.error(message);
    } finally {
      setRerunningJobId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[480px] items-center justify-center">
        <LoadingSpinner text="正在加载 AI 识别工作台..." />
      </div>
    );
  }

  return (
    <div className="space-y-6 text-zinc-950">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Vision Pipeline</p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-950">ParkGov AI 识别工作台</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            用样例视频和公开数据集 ROI 模型推理验证“图片/视频输入、标准识别 JSON、inference_events、车位状态更新”的闭环；当前不接真实摄像头网络。
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          刷新工作台
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <EvidenceFlowPanel
        campusJob={latestCampusInferenceJob}
        campusMetadata={latestCampusInferenceMetadata}
        publicJob={latestPublicDatasetInferenceJob}
        publicMetadata={latestPublicDatasetInferenceMetadata}
        latestEvent={latestInferenceEvent}
      />

      <LatestWritebackImpactPanel
        job={latestEvidenceJob}
        metadata={latestEvidenceMetadata}
        latestEvent={latestInferenceEvent}
        lots={lots}
      />

      <section className="grid gap-4 xl:grid-cols-2">
        <EvidenceSummaryCard
          label="校园样例验证"
          job={latestCampusInferenceJob}
          metadata={latestCampusInferenceMetadata}
          tone="emerald"
          fallback={{
            title: '等待校园样例写回',
            totalSlots: 24,
            detail: '运行 npm run demo:ai-infer:campus-synthetic 后，将展示校园 ROI、任务和事件证据。'
          }}
        />
        <EvidenceSummaryCard
          label="公开数据集训练"
          job={latestPublicDatasetInferenceJob}
          metadata={latestPublicDatasetInferenceMetadata}
          tone="blue"
          fallback={{
            title: 'CNRPark+EXT 30k 训练完成',
            totalSlots: 30000,
            occupiedCount: 3160,
            confidence: 0.9718,
            detail: '测试 accuracy 0.9718，occupied F1 0.9740，vacant F1 0.9693；公开数据集不代表北京真实场景。'
          }}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'AI 任务', value: aiProcessingJobs.length, detail: activeAiJobCount > 0 ? `${activeAiJobCount} 个正在排队或处理` : '任务队列空闲', icon: Loader2 },
          { label: '视频分析', value: analyses.length, detail: `${pendingCount}/${processingCount} 等待/处理中`, icon: FileVideo },
          { label: '已完成', value: completedCount, detail: '可回看识别结果', icon: CheckCircle2, accent: 'text-emerald-700' },
          { label: '失败任务', value: failedCount + failedAiJobCount, detail: '需检查依赖或视频', icon: XCircle, accent: failedCount + failedAiJobCount > 0 ? 'text-red-700' : 'text-zinc-950' },
          { label: 'AI 事件', value: inferenceEvents.length, detail: `最新 ${formatTimestamp(latestInferenceEvent?.created_at)}`, icon: Signal }
        ].map((metric, index) => {
          const Icon = metric.icon;

          return (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase text-zinc-500">{metric.label}</p>
                <Icon className="h-4 w-4 text-zinc-400" />
              </div>
              <p className={`mt-2 text-3xl font-semibold ${metric.accent || 'text-zinc-950'}`}>{metric.value}</p>
              <p className="mt-1 text-xs text-zinc-500">{metric.detail}</p>
            </motion.div>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-emerald-700" />
              <h2 className="font-semibold text-zinc-950">训练数据与模型证据</h2>
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              展示公开数据集、许可边界和最近模型结果，用于证明后端有真实训练/验证链路。
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-600">
            命令：npm run dataset:registry · npm run train:slot-classifier
          </div>
        </div>
        <div className="grid divide-y divide-zinc-100 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {trainingDatasetEvidence.map((dataset) => (
            <article key={dataset.key} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-950">{dataset.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">{dataset.samples}</p>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  {dataset.status}
                </span>
              </div>
              <dl className="mt-4 space-y-2 text-xs leading-5">
                <div>
                  <dt className="text-zinc-500">许可</dt>
                  <dd className="font-medium text-zinc-800">{dataset.license}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">本地路径</dt>
                  <dd className="break-all font-mono text-[11px] text-zinc-700">{dataset.path}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">训练/验证状态</dt>
                  <dd className="font-medium text-zinc-800">{dataset.metric}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
        <div className="border-t border-zinc-100 px-5 py-3 text-xs leading-5 text-zinc-500">
          这些公开数据集只用于模型训练、泛化验证和挑战杯原型演示，不代表北京或校园真实摄像头接入。
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="space-y-6">
          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="font-semibold text-zinc-950">AI 处理任务队列</h2>
                <p className="mt-1 text-sm text-zinc-500">跟踪图片、视频和数据集识别任务，完成后关联 inference_events 并更新车位状态。</p>
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {[
                  ['all', '全部'],
                  ['queued', '排队'],
                  ['processing', '处理中'],
                  ['completed', '完成'],
                  ['failed', '失败']
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setJobStatusFilter(value)}
                    className={`flex-none rounded-md px-3 py-1.5 text-xs font-medium transition ${
                      jobStatusFilter === value
                        ? 'bg-zinc-950 text-white'
                        : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {filteredAiJobs.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-zinc-500">
                {hasHistoricInferenceWithoutJobs ? (
                  <div className="mx-auto max-w-xl">
                    <p className="font-medium text-zinc-800">已有历史 AI 事件，但还没有登记为处理任务。</p>
                    <p className="mt-2 leading-6">
                      可在后端运行 <span className="font-mono text-xs text-zinc-700">npm run backfill:ai-jobs</span> 或重新执行 <span className="font-mono text-xs text-zinc-700">npm run seed:mvp</span>，把历史识别结果补入任务队列。
                    </p>
                  </div>
                ) : (
                  '暂无符合条件的 AI 处理任务。上传样例视频或运行演示识别后会出现在这里。'
                )}
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {filteredAiJobs.slice(0, 8).map((job) => {
                  const isActive = ['queued', 'processing'].includes(job.status);
                  const progress = Math.max(0, Math.min(Number(job.progress_percent || 0), 100));
                  const metadata = getJobMetadata(job);
                  const totalSlots = Number(metadata.total_slots || job.inference_total_slots || 0);
                  const occupiedCount = Number(metadata.occupied_count || job.inference_occupied_count || 0);
                  const vacantCount = Number(metadata.vacant_count || job.inference_vacant_count || 0);
                  const confidence = Number(metadata.average_confidence || job.inference_average_confidence || 0);
                  const canRerun = Boolean(job.result_inference_event_id) && !isActive;

                  return (
                    <article key={job.id} className="px-5 py-4">
                      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.6fr_0.7fr_0.8fr] xl:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-zinc-950">
                              {job.input_path || job.job_external_id}
                            </h3>
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${jobStatusTone[job.status] || jobStatusTone.queued}`}>
                              {jobStatusLabels[job.status] || job.status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">
                            {job.parking_lot_name || `停车场 #${job.parking_lot_id || '-'}`} · {jobTypeLabels[job.job_type] || job.job_type} · {formatTimestamp(job.created_at)}
                          </p>
                        </div>

                        <div>
                          <p className="text-sm font-medium text-zinc-800">{job.model_name || '待指定模型'}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {totalSlots > 0
                              ? `${totalSlots} 车位 · ${occupiedCount} 占用 / ${vacantCount} 空闲`
                              : '模型'}
                          </p>
                        </div>

                        <div>
                          <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                            <div
                              className={`h-full rounded-full ${job.status === 'failed' ? 'bg-red-500' : job.status === 'completed' ? 'bg-emerald-600' : 'bg-zinc-950'}`}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">进度 {progress}%</p>
                        </div>

                        <div className="flex flex-wrap gap-2 xl:justify-end">
                          {job.result_inference_event_id ? (
                            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                              事件 #{job.result_inference_event_id}
                            </span>
                          ) : (
                            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600">
                              未写回事件
                            </span>
                          )}
                          {isActive && (
                            <button
                              type="button"
                              onClick={() => cancelAiJob(job.id)}
                              className="rounded-md border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50"
                            >
                              取消
                            </button>
                          )}
                          {canRerun && (
                            <button
                              type="button"
                              onClick={() => rerunAiJob(job.id)}
                              disabled={rerunningJobId === job.id}
                              className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {rerunningJobId === job.id ? '重跑中...' : '重跑 demo'}
                            </button>
                          )}
                        </div>
                      </div>

                      {(totalSlots > 0 || confidence > 0 || metadata.source || metadata.rerun_from_job_id) && (
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
                          {confidence > 0 && (
                            <span className="rounded-md bg-zinc-50 px-2 py-1">
                              平均置信度 {(confidence * 100).toFixed(1)}%
                            </span>
                          )}
                          {metadata.source && (
                            <span className="rounded-md bg-zinc-50 px-2 py-1">
                              来源 {metadata.source}
                            </span>
                          )}
                          {metadata.rerun_from_job_id && (
                            <span className="rounded-md bg-zinc-50 px-2 py-1">
                              重跑自任务 #{metadata.rerun_from_job_id}
                            </span>
                          )}
                        </div>
                      )}

                      {job.error_message && (
                        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">
                          {job.error_message}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold text-zinc-950">识别任务入口</h2>
              <p className="mt-1 text-sm text-zinc-500">优先使用本地样例视频、公开数据集图片和演示识别任务，不上传敏感车牌和个人信息。</p>
            </div>

            <div className="grid gap-5 p-5 lg:grid-cols-[1fr_1fr]">
              <div className="space-y-4">
                <div>
                  <label htmlFor="video-lot" className="mb-1 block text-sm font-medium text-zinc-700">
                    停车场
                  </label>
                  <select
                    id="video-lot"
                    value={selectedLotId}
                    onChange={(event) => setSelectedLotId(event.target.value)}
                    className="form-input"
                  >
                    <option value="">选择停车场</option>
                    {lots.map((lot) => (
                      <option key={lot.id} value={lot.id}>
                        {lot.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-950">{selectedLot?.name || '未选择停车场'}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {selectedMetadata.district || '未知区域'} · {sourceLabels[selectedMetadata.source_type] || selectedMetadata.source_type || '演示数据'}
                      </p>
                    </div>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      剩余 {selectedLotStats.available}/{selectedLotStats.total}
                    </span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
                    <div
                      className="h-full rounded-full bg-zinc-950"
                      style={{ width: `${Math.min(selectedLotStats.occupancy, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">当前占用率 {selectedLotStats.occupancy}%</p>
                </div>
              </div>

              <div className="space-y-4">
                <label
                  htmlFor="video-file"
                  className="flex min-h-[148px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center hover:bg-zinc-100"
                >
                  <UploadCloud className="h-8 w-8 text-zinc-500" />
                  <p className="mt-3 text-sm font-medium text-zinc-950">
                    {selectedFile ? selectedFile.name : '选择样例视频文件'}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    支持后端视频处理接口；公开数据集图片可通过模型推理入口自动生成标准 JSON。
                  </p>
                  <input
                    id="video-file"
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                  />
                </label>

                <div className="grid gap-3 xl:grid-cols-2">
                  <button
                    type="button"
                    onClick={handleUpload}
                    disabled={uploading || !selectedLotId || !selectedFile}
                    className="inline-flex items-center justify-center rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <UploadCloud className="mr-2 h-4 w-4" />
                    {uploading ? '上传中...' : '上传并识别'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRunDemo}
                    disabled={runningDemo || !selectedLotId}
                    className="inline-flex items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {runningDemo ? '启动中...' : '生成演示识别'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRunModelInference}
                    disabled={runningModelInference}
                    className="inline-flex items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Cpu className="mr-2 h-4 w-4" />
                    {runningModelInference ? '推理中...' : '公开数据集推理'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRunCampusInference}
                    disabled={runningCampusInference}
                    className="inline-flex items-center justify-center rounded-md border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-60 xl:col-span-2"
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    {runningCampusInference ? '验证中...' : '校园样例验证'}
                  </button>
                </div>

                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-start gap-3">
                    <Cpu className="mt-0.5 h-5 w-5 flex-none text-emerald-700" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-950">两条可信验证路径</p>
                      <p className="mt-1 text-xs leading-5 text-emerald-800">
                        公开数据集推理用于证明训练模型能力；校园样例验证用于证明校园停车场、视频源、ROI 和车位写回链路。两者都不是实时摄像头接入。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold text-zinc-950">AI 验证证据链</h2>
              <p className="mt-1 text-sm text-zinc-500">把公开训练数据和校园样例验证分开展示，用于说明模型、ROI、任务、事件和车位写回不是手工静态展示。</p>
            </div>

            <div className="grid gap-4 p-5 xl:grid-cols-2">
              <EvidenceChainCard
                title="校园样例验证"
                description="用校园东门停车场、校园样例视频源和 24 个 ROI 验证写回链路；当前可用合成非敏感图片，后续替换为授权校园样例。"
                job={latestCampusInferenceJob}
                metadata={latestCampusInferenceMetadata}
                emptyText="尚未完成校园样例验证。点击“校园样例验证”，或运行 npm run demo:ai-infer:campus-synthetic。"
                tone="emerald"
              />
              <EvidenceChainCard
                title="公开数据集验证"
                description="用 CNRPark+EXT 30,000 样本训练模型和公开样例 ROI 验证模型推理、标准 JSON、AI 事件和车位状态更新。"
                job={latestPublicDatasetInferenceJob}
                metadata={latestPublicDatasetInferenceMetadata}
                emptyText="尚未完成公开数据集自动推理。点击“公开数据集推理”，或运行 npm run demo:ai-infer:cnr。"
                tone="blue"
              />
            </div>
            <div className="border-t border-zinc-100 px-5 py-3 text-xs leading-5 text-zinc-500">
              校园样例验证当前可使用合成非敏感图片，不代表真实校园摄像头接入；公开数据集验证不代表北京真实停车场精度结论。
            </div>
          </section>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="font-semibold text-zinc-950">识别任务记录</h2>
                <p className="mt-1 text-sm text-zinc-500">完成任务会携带标准 JSON，并可写回 inference_events 更新车位状态。</p>
              </div>
              <Link to="/admin/status" className="inline-flex items-center text-sm font-medium text-blue-700 hover:text-blue-800">
                查看运维状态
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </div>

            {analyses.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-zinc-500">暂无视频识别任务。</div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {analyses.map((analysis) => {
                  const metrics = getAnalysisMetrics(analysis);
                  const isExpanded = expandedAnalysisId === analysis.id;

                  return (
                    <article key={analysis.id} className="px-5 py-4">
                      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr_0.7fr_0.9fr] lg:items-center">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-zinc-950">{analysis.video_filename}</h3>
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusTone[analysis.processing_status] || statusTone.pending}`}>
                              {statusLabels[analysis.processing_status] || analysis.processing_status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">
                            {analysis.parking_lot_name || `停车场 #${analysis.parking_lot_id}`} · {formatTime(analysis.created_at)}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-zinc-800">{metrics.total || '待生成'} 个车位</p>
                          <p className="mt-1 text-xs text-zinc-500">识别范围</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-zinc-800">
                            {metrics.total ? `${metrics.occupied} 占用 / ${metrics.vacant} 空闲` : '等待结果'}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            置信度 {metrics.averageConfidence ? `${(metrics.averageConfidence * 100).toFixed(1)}%` : '暂无'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          <button
                            type="button"
                            onClick={() => setExpandedAnalysisId(isExpanded ? null : analysis.id)}
                            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                          >
                            {isExpanded ? '收起详情' : '查看详情'}
                          </button>
                          {analysis.processing_status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => cancelProcessing(analysis.id)}
                              className="rounded-md border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50"
                            >
                              取消
                            </button>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                          <div className="grid gap-4 md:grid-cols-4">
                            <div>
                              <p className="text-xs text-zinc-500">任务 ID</p>
                              <p className="mt-1 text-sm font-semibold text-zinc-950">#{analysis.id}</p>
                            </div>
                            <div>
                              <p className="text-xs text-zinc-500">处理耗时</p>
                              <p className="mt-1 text-sm font-semibold text-zinc-950">
                                {analysis.processing_duration ? formatDuration(analysis.processing_duration) : '暂无'}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-zinc-500">AI 事件</p>
                              <p className="mt-1 text-sm font-semibold text-zinc-950">
                                {metrics.inferenceEventId ? `#${metrics.inferenceEventId}` : '未生成'}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-zinc-500">完成时间</p>
                              <p className="mt-1 text-sm font-semibold text-zinc-950">{formatTimestamp(analysis.completed_at)}</p>
                            </div>
                          </div>

                          {analysis.error_message && (
                            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                              {analysis.error_message}
                            </div>
                          )}

                          {metrics.detections.length > 0 && (
                            <div className="mt-4">
                              <p className="text-sm font-semibold text-zinc-950">车位级识别结果</p>
                              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
                                {metrics.detections.slice(0, 40).map((slot) => (
                                  <div
                                    key={slot.slot_id || slot.slot_number}
                                    className={`rounded-md border px-2 py-2 text-center text-xs ${
                                      slot.is_occupied
                                        ? 'border-red-200 bg-red-50 text-red-700'
                                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    }`}
                                  >
                                    <p className="font-semibold">#{slot.slot_number}</p>
                                    <p className="mt-1">{slot.is_occupied ? '占用' : '空闲'}</p>
                                    <p className="mt-1 text-[11px] opacity-80">{Math.round(Number(slot.confidence || 0) * 100)}%</p>
                                  </div>
                                ))}
                              </div>
                              {metrics.detections.length > 40 && (
                                <p className="mt-3 text-xs text-zinc-500">仅预览前 40 个车位，其余结果保存在标准 JSON 中。</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold text-zinc-950">闭环进度</h2>
              <p className="mt-1 text-sm text-zinc-500">演示时按这个链路说明 AI 如何影响余位服务。</p>
            </div>
            <div className="divide-y divide-zinc-100">
              {[
                { label: '选择停车场', done: Boolean(selectedLotId), detail: selectedLot?.name || '待选择', icon: Camera },
                { label: '登记 AI 任务', done: aiProcessingJobs.length > 0, detail: latestAiJob ? `${jobStatusLabels[latestAiJob.status] || latestAiJob.status} · #${latestAiJob.id}` : '等待上传或演示任务', icon: Loader2 },
                { label: '上传样例视频', done: Boolean(latestCompletedAnalysis || analyses.length > 0), detail: analyses.length > 0 ? `${analyses.length} 条视频记录` : '等待视频分析记录', icon: FileVideo },
                { label: '生成标准识别 JSON', done: Boolean(latestCompletedAnalysis), detail: latestCompletedAnalysis ? `视频记录 #${latestCompletedAnalysis.id}` : '等待完成任务', icon: Signal },
                { label: '写入车位状态', done: Boolean(latestInferenceEvent), detail: latestInferenceEvent ? `事件 #${latestInferenceEvent.id}` : '等待 inference event', icon: CheckCircle2 }
              ].map((step) => {
                const Icon = step.icon;

                return (
                  <div key={step.label} className="flex gap-3 px-5 py-4">
                    <div className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg ${step.done ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-950">{step.label}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{step.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold text-zinc-950">最近 AI 事件</h2>
            </div>
            {inferenceEvents.length === 0 ? (
              <div className="px-5 py-6 text-sm text-zinc-500">暂无 AI 识别事件。</div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {inferenceEvents.slice(0, 5).map((event) => (
                  <article key={event.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-950">{event.model_name || 'AI 模型'}</p>
                        <p className="mt-1 text-xs text-zinc-500">{event.parking_lot_name || `停车场 #${event.parking_lot_id}`}</p>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        #{event.id}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      {event.occupied_count} 占用 / {event.vacant_count} 空闲 · {formatTimestamp(event.created_at)}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" />
              <div>
                <p className="font-semibold">演示边界</p>
                <p className="mt-1 leading-6">
                  当前使用样例视频、公开数据集和模拟任务验证链路，不采集车牌、不接真实摄像头网络，也不代表全北京实时部署。
                </p>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
};

export default AdminVideo;
