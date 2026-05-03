import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Camera,
  CheckCircle2,
  Clock,
  Database,
  GitBranch,
  Map,
  ParkingCircle,
  RefreshCw,
  ShieldCheck,
  Signal,
  UploadCloud,
  Video
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useParking } from '../contexts/ParkingContext';
import { adminService, videoService } from '../services/api';
import LoadingSpinner from './LoadingSpinner';
import VideoUpload from './VideoUpload';
import { formatTime, formatDuration } from '../utils/dateUtils';

const getMetadata = (lot) => lot?.slot_configuration?.metadata || {};

const getLotStats = (lot) => {
  const stats = lot?.statistics || {};
  const total = Number(stats.total_slots ?? lot?.total_slots ?? 0);
  const occupied = Number(stats.occupied_slots ?? 0);
  const available = Number(stats.available_slots ?? Math.max(total - occupied, 0));
  const occupancyRate = Number(stats.occupancy_rate ?? (total > 0 ? (occupied / total) * 100 : 0));

  return {
    total,
    occupied,
    available,
    occupancyRate: Number.isFinite(occupancyRate) ? Math.round(occupancyRate * 10) / 10 : 0
  };
};

const getOccupancyTone = (rate) => {
  if (rate >= 90) return 'text-red-700 bg-red-50 border-red-200';
  if (rate >= 75) return 'text-orange-700 bg-orange-50 border-orange-200';
  if (rate >= 50) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-emerald-700 bg-emerald-50 border-emerald-200';
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

const formatPercent = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '0%';
  return `${Math.round(numericValue * 10) / 10}%`;
};

const getArrivalIntentState = (intent) => {
  const expiresAt = intent?.expires_at ? new Date(intent.expires_at).getTime() : null;
  const expired = intent?.status === 'expired' || (expiresAt !== null && expiresAt <= Date.now());
  const shouldSwitch = Boolean(intent?.switch_recommendation?.should_switch);

  if (expired) {
    return {
      label: '已过期',
      tone: 'border-zinc-200 bg-zinc-50 text-zinc-600',
      dot: 'bg-zinc-400',
      priority: 0
    };
  }

  if (shouldSwitch) {
    return {
      label: '建议换备选',
      tone: 'border-amber-200 bg-amber-50 text-amber-800',
      dot: 'bg-amber-500',
      priority: 2
    };
  }

  return {
    label: '出发中',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    dot: 'bg-emerald-500',
    priority: 1
  };
};

const sourceLabels = {
  campus_demo: '校园试点 demo',
  campus_camera: '校园样例视频',
  beijing_open_data_demo: '北京开放数据样例',
  beijing_realtime_parking: '北京实时泊位样例',
  beijing_roadside_parking_basic: '北京路侧/设施样例',
  osm_overpass_parking: 'OSM 候选',
  ai_dataset_demo: 'AI 数据集验证',
  demo: '演示数据'
};

const AdminDashboard = () => {
  const { parkingLots, statistics, loadParkingLots } = useParking();
  const [systemAnalytics, setSystemAnalytics] = useState(null);
  const [recentAnalyses, setRecentAnalyses] = useState([]);
  const [processingQueue, setProcessingQueue] = useState(null);
  const [dataSources, setDataSources] = useState([]);
  const [operations, setOperations] = useState([]);
  const [governanceSummary, setGovernanceSummary] = useState(null);
  const [inferenceEvents, setInferenceEvents] = useState([]);
  const [arrivalIntents, setArrivalIntents] = useState([]);
  const [arrivalIntentSummary, setArrivalIntentSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showVideoUpload, setShowVideoUpload] = useState(false);
  const [error, setError] = useState('');

  const loadDashboardData = async ({ showRefreshing = false } = {}) => {
    if (showRefreshing) setRefreshing(true);
    setLoading((current) => current || !showRefreshing);
    setError('');

    try {
      await loadParkingLots();

      const [
        analyticsResponse,
        analysesResponse,
        queueResponse,
        sourcesResponse,
        operationsResponse,
        governanceResponse,
        inferenceResponse,
        arrivalIntentResponse
      ] = await Promise.allSettled([
        adminService.getSystemAnalytics(7),
        videoService.getRecentAnalyses(8),
        videoService.getProcessingQueue(),
        adminService.getDataSources(),
        adminService.getParkingOperations(),
        adminService.getGovernanceSummary(),
        adminService.getInferenceEvents({ limit: 8 }),
        adminService.getArrivalIntents({ limit: 8 })
      ]);

      if (analyticsResponse.status === 'fulfilled' && analyticsResponse.value.data?.success) {
        setSystemAnalytics(analyticsResponse.value.data.data);
      }
      if (analysesResponse.status === 'fulfilled' && analysesResponse.value.data?.success) {
        setRecentAnalyses(analysesResponse.value.data.data.analyses || []);
      }
      if (queueResponse.status === 'fulfilled' && queueResponse.value.data?.success) {
        setProcessingQueue(queueResponse.value.data.data);
      }
      if (sourcesResponse.status === 'fulfilled' && sourcesResponse.value.data?.success) {
        setDataSources(sourcesResponse.value.data.data.data_sources || []);
      }
      if (operationsResponse.status === 'fulfilled' && operationsResponse.value.data?.success) {
        setOperations(operationsResponse.value.data.data.parking_operations || []);
      }
      if (governanceResponse.status === 'fulfilled' && governanceResponse.value.data?.success) {
        setGovernanceSummary(governanceResponse.value.data.data || null);
      }
      if (inferenceResponse.status === 'fulfilled' && inferenceResponse.value.data?.success) {
        setInferenceEvents(inferenceResponse.value.data.data.inference_events || []);
      }
      if (arrivalIntentResponse.status === 'fulfilled' && arrivalIntentResponse.value.data?.success) {
        setArrivalIntents(arrivalIntentResponse.value.data.data.arrival_intents || []);
        setArrivalIntentSummary(arrivalIntentResponse.value.data.data.summary || null);
      }

      const rejected = [
        analyticsResponse,
        analysesResponse,
        queueResponse,
        sourcesResponse,
        operationsResponse,
        governanceResponse,
        inferenceResponse,
        arrivalIntentResponse
      ].filter((response) => response.status === 'rejected');

      if (rejected.length > 0) {
        setError('部分总览数据暂时不可用，已保留可读取模块。');
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || '总览数据加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [loadParkingLots]);

  const handleRefresh = async () => {
    await loadDashboardData({ showRefreshing: true });
    toast.success('总览已刷新');
  };

  const handleVideoUploadSuccess = () => {
    setShowVideoUpload(false);
    loadDashboardData({ showRefreshing: true });
    toast.success('视频已上传，等待识别队列处理');
  };

  const overallStats = useMemo(() => {
    const fallbackTotal = parkingLots.reduce((sum, lot) => sum + getLotStats(lot).total, 0);
    const fallbackAvailable = parkingLots.reduce((sum, lot) => sum + getLotStats(lot).available, 0);
    const fallbackOccupied = Math.max(fallbackTotal - fallbackAvailable, 0);
    const analyticsStats = systemAnalytics?.overall_statistics || {};
    const totalSlots = Number(analyticsStats.total_slots ?? statistics.totalSlots ?? fallbackTotal);
    const totalLots = Number(analyticsStats.total_lots ?? parkingLots.length);
    const occupiedSlots = Number(analyticsStats.occupied_slots ?? statistics.occupiedSlots ?? fallbackOccupied);
    const availableSlots = Number(analyticsStats.available_slots ?? statistics.availableSlots ?? fallbackAvailable);
    const occupancyRate = Number(
      analyticsStats.overall_occupancy_rate
        ?? statistics.occupancyRate
        ?? (totalSlots > 0 ? (occupiedSlots / totalSlots) * 100 : 0)
    );

    return {
      totalLots,
      totalSlots,
      occupiedSlots,
      availableSlots,
      occupancyRate: Number.isFinite(occupancyRate) ? Math.round(occupancyRate * 10) / 10 : 0
    };
  }, [parkingLots, statistics, systemAnalytics]);

  const topLots = useMemo(() => {
    return [...parkingLots]
      .map((lot) => ({
        ...lot,
        metadata: getMetadata(lot),
        stats: getLotStats(lot)
      }))
      .sort((first, second) => second.stats.occupancyRate - first.stats.occupancyRate)
      .slice(0, 5);
  }, [parkingLots]);

  const operationSummary = useMemo(() => {
    const alertLots = operations.filter((lot) => lot.alerts?.length > 0).length;
    const lowRoiLots = operations.filter((lot) => Number(lot.roi?.roi_coverage_rate || 0) < 80).length;
    const staleInferenceLots = operations.filter((lot) => lot.alerts?.some((alert) => ['no_inference_event', 'stale_inference'].includes(alert.code))).length;
    const cameraSources = operations.reduce((sum, lot) => sum + Number(lot.camera?.camera_source_count || 0), 0);
    const latestInference = operations
      .map((lot) => lot.inference?.latest_event_at)
      .filter(Boolean)
      .sort((first, second) => new Date(second) - new Date(first))[0];

    return {
      alertLots,
      lowRoiLots,
      staleInferenceLots,
      cameraSources,
      latestInference
    };
  }, [operations]);

  const arrivalIntentMonitor = useMemo(() => {
    const enriched = arrivalIntents.map((intent) => ({
      ...intent,
      monitorState: getArrivalIntentState(intent)
    }));
    const active = enriched.filter((intent) => intent.status === 'active' && !getArrivalIntentState(intent).label.includes('过期')).length;
    const switchNeeded = enriched.filter((intent) => intent.switch_recommendation?.should_switch).length;
    const averageProbability = enriched.length > 0
      ? Math.round(enriched.reduce((sum, intent) => sum + Number(intent.current_assurance?.probability ?? intent.lot_snapshot?.probability ?? 0), 0) / enriched.length)
      : 0;
    const ordered = [...enriched].sort((first, second) => second.monitorState.priority - first.monitorState.priority);

    return {
      active,
      switchNeeded,
      averageProbability,
      records: ordered
    };
  }, [arrivalIntents]);

  const readinessItems = useMemo(() => {
    const p0Sources = dataSources.filter((source) => source.priority === 'P0');
    const completedP0 = p0Sources.filter((source) => source.latest_import_status === 'completed').length;
    const hasAiEvent = inferenceEvents.length > 0 || Boolean(operationSummary.latestInference);
    const hasCandidateReview = Number(governanceSummary?.candidates?.shortlisted || 0) + Number(governanceSummary?.candidates?.linked || 0) > 0;

    return [
      {
        label: '停车场与车位数据',
        status: overallStats.totalLots > 0 && overallStats.totalSlots > 0,
        detail: `${overallStats.totalLots} 个停车场，${overallStats.totalSlots} 个车位`
      },
      {
        label: 'AI 识别 JSON 闭环',
        status: hasAiEvent,
        detail: hasAiEvent ? `最新事件 ${formatTimestamp(operationSummary.latestInference || inferenceEvents[0]?.created_at)}` : '等待图片/视频识别事件'
      },
      {
        label: '视频源与 ROI 覆盖',
        status: operationSummary.cameraSources > 0 && operationSummary.lowRoiLots < operations.length,
        detail: `${operationSummary.cameraSources} 路来源，${operationSummary.lowRoiLots} 个场站 ROI 不足`
      },
      {
        label: '核心数据源导入',
        status: p0Sources.length > 0 && completedP0 > 0,
        detail: `P0 数据源完成 ${completedP0}/${p0Sources.length || 0}`
      },
      {
        label: '治理候选资源核验',
        status: hasCandidateReview,
        detail: hasCandidateReview ? '已有关注或关联候选点' : '等待候选点人工核验'
      }
    ];
  }, [dataSources, governanceSummary, inferenceEvents, operationSummary, operations.length, overallStats]);

  const nextActions = [
    {
      title: '证明 AI 到余位的闭环',
      detail: '继续用公开样例图片/视频生成识别事件，写回车位状态并同步用户端推荐。',
      href: '/admin/video'
    },
    {
      title: '补齐分流推荐证据',
      detail: '在状态页核验高占用场站、ROI 覆盖和最近识别时间，支撑“为什么推荐”。',
      href: '/admin/status'
    },
    {
      title: '核验治理候选资源',
      detail: '把 OSM 候选点标记为关注、关联或剔除，形成压力分流的治理证据链。',
      href: '/admin/governance'
    }
  ];

  const demoJourneyActions = [
    {
      step: '01',
      title: '生成到场计划',
      detail: '打开停车服务页，看推荐车场、可停概率、Plan B 和演示到场码如何形成出发前保障。',
      href: '/parking-lots',
      icon: ParkingCircle
    },
    {
      step: '02',
      title: 'AI 怎么证明',
      detail: '进入视频识别工作台，查看公开数据集训练结果、推理任务、AI 事件和车位写回记录。',
      href: '/admin/video',
      icon: Camera
    },
    {
      step: '03',
      title: '管理端怎么看',
      detail: '核验停车场占用率、ROI 覆盖、最近 AI 信号和到场保障质量，解释哪些场站不稳。',
      href: '/admin/status',
      icon: Signal
    },
    {
      step: '04',
      title: '治理端怎么分流',
      detail: '查看高风险目的地、Plan B/Plan C 承接点和“建议诱导/建议补数据”的保守治理建议。',
      href: '/admin/governance',
      icon: Map
    }
  ];

  if (loading) {
    return (
      <div className="flex min-h-[480px] items-center justify-center">
        <LoadingSpinner text="正在加载项目总览..." />
      </div>
    );
  }

  return (
    <div className="space-y-6 text-zinc-950">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">ParkGov Command Center</p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-950">ParkGov AI 项目总览</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            汇总车位感知、分流推荐、数据源接入和治理候选资源，展示当前挑战杯 MVP 的工程完成度。
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setShowVideoUpload(true)}
            className="inline-flex items-center justify-center rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            上传样例视频
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新总览
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {error}
        </div>
      )}

      <section className="grid gap-3 lg:grid-cols-3">
        {[
          {
            title: '用户端：更稳妥地去哪停',
            body: '不是只找最近或最低价，而是按余位、距离、拥挤缓解和数据可信度给出可解释推荐。',
            icon: GitBranch
          },
          {
            title: '管理端：识别闭环可信',
            body: '用 AI 事件、ROI 覆盖、摄像头/样例源和车位状态证明余位不是手填演示。',
            icon: Camera
          },
          {
            title: '治理端：分散压力和核验资源',
            body: '把高占用停车场、区域占用率和 OSM 候选点关联为待调研、待诱导的治理线索。',
            icon: Map
          }
        ].map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.title} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-emerald-700" />
                <h2 className="text-sm font-semibold text-zinc-950">{item.title}</h2>
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">{item.body}</p>
            </article>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-zinc-200 px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-emerald-700">演示导览</p>
            <h2 className="mt-1 font-semibold text-zinc-950">三分钟演示路线</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">
              这条路线放在管理端给评审和小组讲解使用；用户端只保留停车服务，不打断找车位主任务。
            </p>
          </div>
          <span className="inline-flex w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            到场计划 → AI 写回 → 风险变化 → 备选承接
          </span>
        </div>
        <div className="grid divide-y divide-zinc-100 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          {demoJourneyActions.map((item) => {
            const Icon = item.icon;

            return (
              <Link key={item.step} to={item.href} className="block p-5 transition hover:bg-zinc-50">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-emerald-700">{item.step}</span>
                  <Icon className="h-4 w-4 text-zinc-400" />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-zinc-950">{item.title}</h3>
                <p className="mt-2 min-h-[60px] text-xs leading-5 text-zinc-500">{item.detail}</p>
                <span className="mt-4 inline-flex items-center text-xs font-semibold text-zinc-950">
                  打开
                  <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-emerald-100 bg-emerald-50/70 px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <h2 className="font-semibold text-zinc-950">到场计划监控</h2>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-emerald-900">
              观察用户端生成的演示到场码是否仍然稳妥；这里只做试点监控，不代表真实预约或锁位。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs lg:w-[360px]">
            <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
              <p className="font-semibold text-zinc-950">{arrivalIntentSummary?.active ?? arrivalIntentMonitor.active}</p>
              <p className="mt-1 text-zinc-500">活跃计划</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-white px-3 py-2">
              <p className="font-semibold text-amber-700">{arrivalIntentMonitor.switchNeeded}</p>
              <p className="mt-1 text-zinc-500">需看备选</p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
              <p className="font-semibold text-zinc-950">{arrivalIntentMonitor.averageProbability}%</p>
              <p className="mt-1 text-zinc-500">平均可停</p>
            </div>
          </div>
        </div>

        {arrivalIntentMonitor.records.length === 0 ? (
          <div className="px-5 py-6 text-sm text-zinc-500">
            暂无到场计划。用户端生成到场码后，这里会显示计划状态、余位变化和 Plan B 建议。
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {arrivalIntentMonitor.records.slice(0, 5).map((intent) => {
              const snapshot = intent.lot_snapshot || {};
              const current = intent.current_assurance || {};
              const delta = intent.snapshot_delta || {};
              const alternatives = Array.isArray(intent.alternatives) ? intent.alternatives.slice(0, 2) : [];

              return (
                <article key={intent.display_code} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_120px_130px_180px] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${intent.monitorState.tone}`}>
                        <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${intent.monitorState.dot}`} />
                        {intent.monitorState.label}
                      </span>
                      <span className="break-all text-xs font-semibold text-emerald-700">{intent.display_code}</span>
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold text-zinc-950">
                      {intent.parking_lot_name || snapshot.name || '停车场'}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      {intent.switch_recommendation?.reason || '当前风险未明显升高，可继续观察到场状态。'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-950">{current.probability ?? snapshot.probability ?? '--'}%</p>
                    <p className="text-xs text-zinc-500">当前可停</p>
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${Number(delta.available_slots_delta || 0) < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {delta.available_slots_delta === undefined || delta.available_slots_delta === null
                        ? '--'
                        : `${Number(delta.available_slots_delta) >= 0 ? '+' : ''}${delta.available_slots_delta}`}
                    </p>
                    <p className="text-xs text-zinc-500">较生成时余位</p>
                  </div>
                  <div className="text-xs leading-5 text-zinc-600">
                    {alternatives.length > 0
                      ? alternatives.map((lot, index) => `${index === 0 ? 'Plan B' : 'Plan C'}：${lot.name} ${lot.probability}%`).join('；')
                      : '暂无备选承接点'}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: '停车场', value: overallStats.totalLots, detail: '纳入演示与试点', icon: ParkingCircle },
          { label: '总车位', value: overallStats.totalSlots, detail: '数据库当前容量', icon: Database },
          { label: '剩余车位', value: overallStats.availableSlots, detail: '可用于用户端展示', icon: Signal, accent: 'text-emerald-700' },
          { label: '占用率', value: formatPercent(overallStats.occupancyRate), detail: '全局样例口径', icon: BarChart3 },
          { label: 'AI 事件', value: inferenceEvents.length, detail: `最新 ${formatTimestamp(operationSummary.latestInference || inferenceEvents[0]?.created_at)}`, icon: Camera }
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

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.8fr)]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-zinc-950">停车场运行概况</h2>
                <p className="mt-1 text-sm text-zinc-500">按占用率排序，优先暴露高占用或异常场站。</p>
              </div>
              <Link to="/admin/status" className="inline-flex items-center text-sm font-medium text-blue-700 hover:text-blue-800">
                运维状态
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </div>
            {topLots.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-zinc-500">暂无停车场数据</div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {topLots.map((lot) => (
                  <article key={lot.id} className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_120px_1.2fr] md:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-zinc-950">{lot.name}</h3>
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getOccupancyTone(lot.stats.occupancyRate)}`}>
                          占用 {lot.stats.occupancyRate}%
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">
                        {lot.metadata.district || '未知区域'} · {sourceLabels[lot.metadata.source_type] || lot.metadata.source_type || '演示数据'}
                      </p>
                    </div>
                    <div>
                      <p className="text-2xl font-semibold text-emerald-700">{lot.stats.available}</p>
                      <p className="text-xs text-zinc-500">剩余 / {lot.stats.total}</p>
                    </div>
                    <div>
                      <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                        <div className="h-full rounded-full bg-zinc-950" style={{ width: `${Math.min(lot.stats.occupancyRate, 100)}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">{lot.metadata.address || '暂无地址'}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
              <div className="border-b border-zinc-200 px-5 py-4">
                <h2 className="font-semibold text-zinc-950">AI 识别与视频队列</h2>
                <p className="mt-1 text-sm text-zinc-500">展示样例视频处理与标准 inference event 结果。</p>
              </div>
              <div className="divide-y divide-zinc-100">
                {inferenceEvents.slice(0, 3).map((event) => (
                  <article key={event.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-950">{event.model_name || 'AI 模型'}</p>
                        <p className="mt-1 text-xs text-zinc-500">{event.camera_name || event.camera_external_id || '未绑定来源'}</p>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        {event.occupied_count}/{event.total_slots} 占用
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      平均置信度 {event.average_confidence ? Number(event.average_confidence).toFixed(2) : '暂无'} · {formatTimestamp(event.created_at)}
                    </p>
                  </article>
                ))}
                {inferenceEvents.length === 0 && (
                  <div className="px-5 py-6 text-sm text-zinc-500">暂无 AI 事件，等待图片/视频识别 JSON 写入。</div>
                )}
              </div>
              <div className="border-t border-zinc-200 px-5 py-4 text-sm text-zinc-600">
                处理队列待处理：{processingQueue?.queue?.pending || 0}，处理中：{processingQueue?.queue?.processing || 0}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
              <div className="border-b border-zinc-200 px-5 py-4">
                <h2 className="font-semibold text-zinc-950">最近视频分析</h2>
                <p className="mt-1 text-sm text-zinc-500">用于演示视频入口，不接真实摄像头网络。</p>
              </div>
              {recentAnalyses.length === 0 ? (
                <div className="px-5 py-6 text-sm text-zinc-500">暂无近期视频分析。</div>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {recentAnalyses.slice(0, 4).map((analysis) => (
                    <article key={analysis.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-950">{analysis.video_filename}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {analysis.parking_lot_name || '未绑定停车场'} · {formatTime(analysis.created_at)}
                          </p>
                        </div>
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                          {analysis.processing_status}
                        </span>
                      </div>
                      {analysis.processing_duration_seconds && (
                        <p className="mt-2 text-xs text-zinc-500">
                          耗时 {formatDuration(analysis.processing_duration_seconds)}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold text-zinc-950">MVP 完成度</h2>
              <p className="mt-1 text-sm text-zinc-500">按演示可信度而不是生产成熟度评估。</p>
            </div>
            <div className="divide-y divide-zinc-100">
              {readinessItems.map((item) => (
                <div key={item.label} className="flex gap-3 px-5 py-4">
                  {item.status ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-600" />
                  ) : (
                    <Clock className="mt-0.5 h-5 w-5 flex-none text-amber-600" />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-zinc-950">{item.label}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold text-zinc-950">治理侧风险提示</h2>
            </div>
            <div className="space-y-3 p-5 text-sm">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-700" />
                <p className="text-zinc-600">{operationSummary.alertLots} 个停车场存在运维提示，需在状态页逐项核验。</p>
              </div>
              <div className="flex items-start gap-3">
                <Camera className="mt-0.5 h-4 w-4 flex-none text-blue-700" />
                <p className="text-zinc-600">{operationSummary.staleInferenceLots} 个停车场缺少近期 AI 事件，不能作为实时余位证明。</p>
              </div>
              <div className="flex items-start gap-3">
                <Map className="mt-0.5 h-4 w-4 flex-none text-emerald-700" />
                <p className="text-zinc-600">候选 POI 仅用于治理资源核验，不代表真实权属或实时泊位。</p>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-semibold text-zinc-950">下一步动作</h2>
            </div>
            <div className="divide-y divide-zinc-100">
              {nextActions.map((action) => (
                <Link key={action.title} to={action.href} className="block px-5 py-4 hover:bg-zinc-50">
                  <p className="text-sm font-semibold text-zinc-950">{action.title}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">{action.detail}</p>
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </section>

      {showVideoUpload && (
        <VideoUpload
          isOpen={showVideoUpload}
          onClose={() => setShowVideoUpload(false)}
          onSuccess={handleVideoUploadSuccess}
          parkingLots={parkingLots}
        />
      )}
    </div>
  );
};

export default AdminDashboard;
