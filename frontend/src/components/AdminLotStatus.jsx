import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Camera,
  Clock,
  Database,
  MapPin,
  RefreshCw,
  Router,
  Signal
} from 'lucide-react';
import { adminService, parkingService } from '../services/api';
import LoadingSpinner from './LoadingSpinner';

const sourceLabels = {
  campus_demo: '校园试点 demo',
  campus_camera: '校园样例视频',
  beijing_open_data_demo: '北京开放数据样例',
  beijing_realtime_parking: '北京实时泊位样例',
  beijing_roadside_parking_basic: '北京路侧/设施样例',
  osm_overpass_parking: 'OSM 候选',
  ai_dataset_demo: 'AI 公开数据集验证',
  demo: '演示数据'
};

const cameraKindLabels = {
  image: '图片采样',
  video_file: '视频文件',
  rtsp: 'RTSP',
  http_stream: 'HTTP 流',
  manual_demo: '人工/开放数据占位'
};

const cameraStatusLabels = {
  planned: '待接入',
  online: '在线',
  offline: '离线',
  sample: '样例源',
  disabled: '停用'
};

const getMetadata = (lot) => lot?.slot_configuration?.metadata || {};

const getLotStats = (lot) => {
  const stats = lot?.statistics || {};
  const total = Number(stats.total_slots ?? lot?.total_slots ?? 0);
  const occupied = Number(stats.occupied_slots ?? 0);
  const available = Number(stats.available_slots ?? Math.max(total - occupied, 0));
  const rawOccupancy = Number(stats.occupancy_rate ?? (total > 0 ? (occupied / total) * 100 : 0));

  return {
    total,
    occupied,
    available,
    occupancy: Number.isFinite(rawOccupancy) ? Math.round(rawOccupancy * 10) / 10 : 0
  };
};

const getSlotStats = (slots, fallbackLot) => {
  if (!slots.length) {
    return getLotStats(fallbackLot);
  }

  const total = slots.length;
  const occupied = slots.filter((slot) => slot.is_occupied).length;
  const available = total - occupied;
  const occupancy = total > 0 ? Math.round((occupied / total) * 1000) / 10 : 0;

  return { total, occupied, available, occupancy };
};

const getCrowdStatus = (occupancy) => {
  if (occupancy >= 90) {
    return {
      label: '满位预警',
      tone: 'text-red-700 bg-red-50 border-red-200',
      bar: 'bg-red-600',
      priority: 3
    };
  }
  if (occupancy >= 75) {
    return {
      label: '高占用',
      tone: 'text-orange-700 bg-orange-50 border-orange-200',
      bar: 'bg-orange-500',
      priority: 2
    };
  }
  if (occupancy >= 50) {
    return {
      label: '运行较忙',
      tone: 'text-amber-700 bg-amber-50 border-amber-200',
      bar: 'bg-amber-500',
      priority: 1
    };
  }

  return {
    label: '余位充足',
    tone: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    bar: 'bg-emerald-600',
    priority: 0
  };
};

const getCameraStatusClassName = (status) => {
  switch (status) {
    case 'online':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'offline':
      return 'border-red-200 bg-red-50 text-red-700';
    case 'sample':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    case 'disabled':
      return 'border-slate-200 bg-slate-100 text-slate-500';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700';
  }
};

const formatTimestamp = (value) => {
  if (!value) {
    return '暂无记录';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
};

const formatDuration = (seconds) => {
  const value = Number(seconds || 0);
  if (value <= 0) {
    return '待预测';
  }
  if (value < 60) {
    return `${value} 秒`;
  }
  if (value < 3600) {
    return `${Math.round(value / 60)} 分钟`;
  }
  return `${Math.round((value / 3600) * 10) / 10} 小时`;
};

const formatConfidence = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return '待评估';
  }

  return `${Math.round(numericValue * 1000) / 10}%`;
};

const getAlertTone = (level) => {
  switch (level) {
    case 'critical':
      return 'border-red-200 bg-red-50 text-red-700';
    case 'warning':
      return 'border-orange-200 bg-orange-50 text-orange-700';
    default:
      return 'border-sky-200 bg-sky-50 text-sky-700';
  }
};

const getAlertLabel = (code) => {
  const labels = {
    high_occupancy: '高占用',
    low_roi_coverage: 'ROI 不足',
    no_camera_source: '缺少视频源',
    no_inference_event: '无 AI 事件',
    stale_inference: '识别过期',
    offline_camera_source: '视频源离线',
    open_data_stale: '开放数据过期',
    arrival_assurance_low: '保障偏低'
  };

  return labels[code] || code;
};

const AdminLotStatus = () => {
  const [lots, setLots] = useState([]);
  const [selectedLotId, setSelectedLotId] = useState('');
  const [statusLot, setStatusLot] = useState(null);
  const [slots, setSlots] = useState([]);
  const [cameraSources, setCameraSources] = useState([]);
  const [inferenceEvents, setInferenceEvents] = useState([]);
  const [operations, setOperations] = useState({ parking_operations: [], summary: null });
  const [loadingLots, setLoadingLots] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingCameras, setLoadingCameras] = useState(false);
  const [loadingInference, setLoadingInference] = useState(false);
  const [loadingOperations, setLoadingOperations] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');

  const loadLots = async () => {
    setLoadingLots(true);
    setError('');

    try {
      const response = await parkingService.getAllParkingLots();
      const nextLots = response.data?.data?.parking_lots || response.data?.data || [];
      setLots(nextLots);

      if (!selectedLotId && nextLots.length > 0) {
        setSelectedLotId(String(nextLots[0].id));
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || '停车场状态加载失败');
    } finally {
      setLoadingLots(false);
    }
  };

  const loadCameraSources = async () => {
    setLoadingCameras(true);

    try {
      const response = await adminService.getCameraSources();
      setCameraSources(response.data?.data?.camera_sources || []);
    } catch (requestError) {
      setCameraSources([]);
      setError(requestError.response?.data?.error || requestError.message || '摄像头来源加载失败');
    } finally {
      setLoadingCameras(false);
    }
  };

  const loadInferenceEvents = async () => {
    setLoadingInference(true);

    try {
      const response = await adminService.getInferenceEvents({ limit: 50 });
      setInferenceEvents(response.data?.data?.inference_events || []);
    } catch (requestError) {
      setInferenceEvents([]);
      setError(requestError.response?.data?.error || requestError.message || 'AI 识别事件加载失败');
    } finally {
      setLoadingInference(false);
    }
  };

  const loadOperations = async () => {
    setLoadingOperations(true);

    try {
      const response = await adminService.getParkingOperations();
      setOperations(response.data?.data || { parking_operations: [], summary: null });
    } catch (requestError) {
      setOperations({ parking_operations: [], summary: null });
      setError(requestError.response?.data?.error || requestError.message || '运维聚合数据加载失败');
    } finally {
      setLoadingOperations(false);
    }
  };

  const loadSelectedLotStatus = async (lotId = selectedLotId) => {
    if (!lotId) {
      return;
    }

    setLoadingStatus(true);
    setError('');

    try {
      const response = await parkingService.getParkingStatus(lotId);
      const data = response.data?.data || {};
      setStatusLot(data.parking_lot || null);
      setSlots(data.slots || []);
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || '车位明细加载失败');
      setSlots([]);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadLots();
    loadCameraSources();
    loadInferenceEvents();
    loadOperations();
  }, []);

  useEffect(() => {
    if (selectedLotId) {
      loadSelectedLotStatus(selectedLotId);
    }
  }, [selectedLotId]);

  const filteredLots = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return lots
      .filter((lot) => {
        const metadata = getMetadata(lot);
        const sourceType = metadata.source_type || 'demo';
        const matchesSource = sourceFilter === 'all' || sourceType === sourceFilter;
        const haystack = [
          lot.name,
          metadata.district,
          metadata.address,
          metadata.source_external_id,
          sourceLabels[sourceType]
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return matchesSource && (!normalizedQuery || haystack.includes(normalizedQuery));
      })
      .sort((first, second) => {
        const firstStatus = getCrowdStatus(getLotStats(first).occupancy);
        const secondStatus = getCrowdStatus(getLotStats(second).occupancy);
        return secondStatus.priority - firstStatus.priority || getLotStats(second).occupancy - getLotStats(first).occupancy;
      });
  }, [lots, query, sourceFilter]);

  const selectedLot = statusLot || lots.find((lot) => String(lot.id) === String(selectedLotId)) || null;
  const selectedOperation = operations.parking_operations?.find((lot) => String(lot.id) === String(selectedLot?.id)) || null;
  const selectedOperationAlerts = selectedOperation?.alerts || [];
  const selectedCameraSources = cameraSources.filter((camera) => String(camera.parking_lot_id) === String(selectedLot?.id));
  const selectedInferenceEvents = inferenceEvents.filter((event) => String(event.parking_lot_id) === String(selectedLot?.id));
  const latestInferenceEvent = selectedInferenceEvents[0] || null;
  const selectedStats = getSlotStats(slots, selectedLot);
  const roiSlots = slots.filter((slot) => slot.coordinates?.source_type === 'roi_csv');
  const roiCoverageRate = selectedStats.total > 0 ? Math.round((roiSlots.length / selectedStats.total) * 100) : 0;
  const roiCameraSources = Array.from(
    new Set(roiSlots.map((slot) => slot.coordinates?.camera_external_id).filter(Boolean))
  );
  const selectedMetadata = getMetadata(selectedLot);
  const selectedStatus = getCrowdStatus(selectedStats.occupancy);
  const latestSlotUpdate = slots.reduce((latest, slot) => {
    const timestamp = slot.updated_at || slot.last_status_change;
    if (!timestamp) {
      return latest;
    }
    if (!latest || new Date(timestamp) > new Date(latest)) {
      return timestamp;
    }
    return latest;
  }, selectedLot?.updated_at || selectedMetadata.imported_at || '');

  const summary = useMemo(() => {
    if (operations.summary) {
      return {
        totalLots: Number(operations.summary.total_lots || 0),
        totalSpaces: Number(operations.summary.total_slots || 0),
        availableSpaces: Number(operations.summary.available_slots || 0),
        occupiedSpaces: Number(operations.summary.occupied_slots || 0),
        alertLots: Number(operations.summary.high_occupancy_lots || 0),
        configuredVideoSources: cameraSources.length,
        staleInferenceLots: Number(operations.summary.stale_inference_lots || 0),
        lowRoiCoverageLots: Number(operations.summary.low_roi_coverage_lots || 0),
        averageArrivalAssuranceScore: Math.round(Number(operations.summary.average_arrival_assurance_score || 0))
      };
    }

    return lots.reduce(
      (accumulator, lot) => {
        const stats = getLotStats(lot);
        accumulator.totalLots += 1;
        accumulator.totalSpaces += stats.total;
        accumulator.availableSpaces += stats.available;
        accumulator.occupiedSpaces += stats.occupied;
        accumulator.alertLots += getCrowdStatus(stats.occupancy).priority >= 2 ? 1 : 0;
        accumulator.configuredVideoSources = cameraSources.length || accumulator.configuredVideoSources + (lot.video_url ? 1 : 0);
        return accumulator;
      },
      {
        totalLots: 0,
        totalSpaces: 0,
        availableSpaces: 0,
        occupiedSpaces: 0,
        alertLots: 0,
        configuredVideoSources: 0,
        staleInferenceLots: 0,
        lowRoiCoverageLots: 0,
        averageArrivalAssuranceScore: 0
      }
    );
  }, [lots, cameraSources, operations.summary]);

  const visibleSlots = useMemo(() => {
    return [...slots].sort((first, second) => Number(first.slot_number) - Number(second.slot_number));
  }, [slots]);

  const handleRefresh = async () => {
    await loadLots();
    await loadCameraSources();
    await loadInferenceEvents();
    await loadOperations();
    if (selectedLotId) {
      await loadSelectedLotStatus(selectedLotId);
    }
  };

  return (
    <div className="space-y-6 text-zinc-950">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Operations Console</p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-950">ParkGov AI 停车场运维工作台</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            聚合余位、ROI 覆盖、视频源、AI 识别事件和异常提示，用于校园试点与公开数据样例的运行核验；当前不是全北京实时摄像头接入。
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loadingLots || loadingStatus || loadingInference || loadingOperations}
          className="inline-flex w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loadingLots || loadingStatus || loadingCameras || loadingInference || loadingOperations ? 'animate-spin' : ''}`} />
          刷新状态
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Managed Lots</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-950">{summary.totalLots}</p>
          <p className="mt-1 text-xs text-zinc-500">停车场纳管数量</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Capacity</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-950">{summary.totalSpaces}</p>
          <p className="mt-1 text-xs text-zinc-500">系统总车位</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Available</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-700">{summary.availableSpaces}</p>
          <p className="mt-1 text-xs text-zinc-500">当前可引导余位</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Alerts</p>
          <p className={`mt-2 text-3xl font-semibold ${summary.alertLots > 0 ? 'text-orange-700' : 'text-zinc-950'}`}>
            {summary.alertLots}
          </p>
          <p className="mt-1 text-xs text-zinc-500">高占用场站</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Sources</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-950">{summary.configuredVideoSources}</p>
          <p className="mt-1 text-xs text-zinc-500">视频/样例数据源</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Assurance</p>
          <p className={`mt-2 text-3xl font-semibold ${summary.averageArrivalAssuranceScore < 60 ? 'text-orange-700' : 'text-emerald-700'}`}>
            {summary.averageArrivalAssuranceScore || '--'}
          </p>
          <p className="mt-1 text-xs text-zinc-500">到场保障均分</p>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索停车场、区域、数据源编号"
              className="form-input"
            />
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="form-input"
            >
              <option value="all">全部来源</option>
              <option value="campus_demo">校园试点 demo</option>
              <option value="campus_camera">校园样例视频</option>
              <option value="beijing_open_data_demo">北京开放数据样例</option>
              <option value="beijing_realtime_parking">北京实时泊位样例</option>
              <option value="beijing_roadside_parking_basic">北京路侧/设施样例</option>
              <option value="osm_overpass_parking">OSM 候选</option>
              <option value="ai_dataset_demo">AI 公开数据集验证</option>
              <option value="demo">演示数据</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-medium text-slate-700">停车场列表</p>
            </div>

            {loadingLots ? (
              <div className="flex min-h-[280px] items-center justify-center">
                <LoadingSpinner text="正在加载停车场..." />
              </div>
            ) : filteredLots.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">暂无匹配停车场</div>
            ) : (
              <div className="max-h-[680px] divide-y divide-slate-100 overflow-y-auto">
                {filteredLots.map((lot, index) => {
                  const metadata = getMetadata(lot);
                  const stats = getLotStats(lot);
                  const status = getCrowdStatus(stats.occupancy);
                  const sourceType = metadata.source_type || 'demo';
                  const isSelected = String(lot.id) === String(selectedLotId);
                  const lotOperation = operations.parking_operations?.find((operation) => String(operation.id) === String(lot.id));
                  const alertCount = lotOperation?.alerts?.length || 0;
                  const latestEventAt = lotOperation?.inference?.latest_event_at;

                  return (
                    <motion.button
                      key={lot.id}
                      type="button"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.02 }}
                      onClick={() => setSelectedLotId(String(lot.id))}
                      className={`w-full px-4 py-4 text-left transition-colors hover:bg-slate-50 ${
                        isSelected ? 'bg-blue-50' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-semibold text-slate-950">{lot.name}</h2>
                          <p className="mt-1 flex items-start text-xs text-slate-500">
                            <MapPin className="mr-1 mt-0.5 h-3.5 w-3.5 flex-none" />
                            <span>{metadata.district || '未知区域'} · {metadata.address || '暂无地址'}</span>
                          </p>
                        </div>
                        <span className={`flex-none rounded-full border px-2 py-0.5 text-xs font-medium ${status.tone}`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-4">
                        <div>
                          <p className="text-2xl font-semibold text-emerald-700">{stats.available}</p>
                          <p className="text-xs text-slate-500">剩余 / {stats.total} 总车位</p>
                        </div>
                        <div className="min-w-[120px]">
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full ${status.bar}`}
                              style={{ width: `${Math.min(stats.occupancy, 100)}%` }}
                            />
                          </div>
                          <p className="mt-1 text-right text-xs text-slate-500">占用率 {stats.occupancy}%</p>
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">
                        {sourceLabels[sourceType] || sourceType}
                        {alertCount > 0 ? ` · ${alertCount} 条运维提示` : ''}
                        {latestEventAt ? ` · AI ${formatTimestamp(latestEventAt)}` : ' · AI 待接入'}
                      </p>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {!selectedLot ? (
            <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-slate-500">
              请选择一个停车场查看状态
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-slate-950">{selectedLot.name}</h2>
                      <span className={`rounded-full border px-3 py-1 text-sm font-medium ${selectedStatus.tone}`}>
                        {selectedStatus.label}
                      </span>
                    </div>
                    <p className="mt-2 flex items-start text-sm text-slate-600">
                      <MapPin className="mr-1.5 mt-0.5 h-4 w-4 flex-none text-slate-400" />
                      <span>{selectedMetadata.district || '未知区域'} · {selectedMetadata.address || '暂无地址'}</span>
                    </p>
                    <p className="mt-2 text-sm text-slate-500">
                      数据源编号：{selectedMetadata.source_external_id || `lot-${selectedLot.id}`}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center sm:min-w-[320px]">
                    <div>
                      <p className="text-2xl font-semibold">{selectedStats.total}</p>
                      <p className="text-xs text-slate-500">总车位</p>
                    </div>
                    <div>
                      <p className="text-2xl font-semibold text-emerald-700">{selectedStats.available}</p>
                      <p className="text-xs text-slate-500">剩余</p>
                    </div>
                    <div>
                      <p className="text-2xl font-semibold">{selectedStats.occupancy}%</p>
                      <p className="text-xs text-slate-500">占用率</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${selectedStatus.bar}`}
                    style={{ width: `${Math.min(selectedStats.occupancy, 100)}%` }}
                  />
                </div>

                {selectedOperationAlerts.length > 0 && (
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    {selectedOperationAlerts.map((alert) => (
                      <div
                        key={alert.code}
                        className={`rounded-lg border p-3 text-sm ${getAlertTone(alert.level)}`}
                      >
                        <p className="font-medium">{getAlertLabel(alert.code)}</p>
                        <p className="mt-1 leading-5">{alert.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Camera className="h-5 w-5 text-blue-700" />
                    视频源状态
                  </div>
                  <p className="mt-3 text-lg font-semibold text-slate-950">
                    {selectedOperation?.camera?.camera_source_count > 0
                      ? `${selectedOperation.camera.camera_source_count} 路来源`
                      : selectedCameraSources.length > 0
                        ? `${selectedCameraSources.length} 路来源`
                      : selectedLot.video_url
                        ? '旧字段已配置'
                        : '待配置'}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {selectedOperation?.camera?.camera_source_count > 0
                      ? `在线 ${selectedOperation.camera.online_count} 路，样例 ${selectedOperation.camera.sample_count} 路，离线 ${selectedOperation.camera.offline_count} 路。`
                      : selectedCameraSources.length > 0
                        ? '已通过 camera_sources 表关联到该停车场。'
                      : selectedLot.video_url || '当前样例通过 CSV 初始化余位，后续可绑定摄像头或视频流。'}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Signal className="h-5 w-5 text-blue-700" />
                    AI 识别结果
                  </div>
                  {selectedOperation?.inference?.latest_event_id || latestInferenceEvent ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-lg font-semibold text-slate-950">
                        {selectedOperation?.inference?.latest_event_id
                          ? `${selectedOperation.inference.latest_occupied_count}/${selectedOperation.inference.latest_total_slots} 已占用`
                          : `${latestInferenceEvent.occupied_count}/${latestInferenceEvent.total_slots} 已占用`}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-zinc-100 px-2 py-1 font-medium text-zinc-700">
                          事件 #{selectedOperation?.inference?.latest_event_id || latestInferenceEvent.id}
                        </span>
                        <span className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                          置信度 {formatConfidence(selectedOperation?.inference?.latest_average_confidence || latestInferenceEvent.average_confidence)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500">
                        {selectedOperation?.inference?.latest_event_id
                          ? `${selectedOperation.inference.latest_model_name || 'AI 模型'} · ${formatTimestamp(selectedOperation.inference.latest_event_at)}`
                          : `${latestInferenceEvent.model_name || 'AI 模型'} · ${formatTimestamp(latestInferenceEvent.created_at)}`}
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="mt-3 text-lg font-semibold text-slate-950">
                        {slots.length > 0 ? `${slots.length} 个车位状态` : '暂无车位状态'}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        当前读取现有车位表，后续由图片/视频识别 JSON 自动更新。
                      </p>
                    </>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Router className="h-5 w-5 text-blue-700" />
                    ROI 标注覆盖
                  </div>
                  <p className="mt-3 text-lg font-semibold text-slate-950">
                    {selectedOperation?.roi
                      ? `${selectedOperation.roi.roi_slots}/${selectedOperation.statistics.total_slots}`
                      : `${roiSlots.length}/${selectedStats.total}`}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {selectedOperation?.roi
                      ? `${selectedOperation.roi.roi_coverage_rate}% 已通过 ROI CSV 标注。`
                      : `${roiCoverageRate}% 已通过 ROI CSV 标注，来源 ${roiCameraSources.length || 0} 路。`}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Clock className="h-5 w-5 text-blue-700" />
                    最近更新时间
                  </div>
                  <p className="mt-3 text-lg font-semibold text-slate-950">
                    {formatTimestamp(latestSlotUpdate)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    包含 CSV 导入或车位状态变更时间。
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4 xl:col-span-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Database className="h-5 w-5 text-emerald-700" />
                    到场保障质量
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
                    <div>
                      <p className={`text-3xl font-semibold ${Number(selectedOperation?.arrival_assurance?.quality_score || 0) < 60 ? 'text-orange-700' : 'text-emerald-700'}`}>
                        {selectedOperation?.arrival_assurance?.quality_score ?? '--'}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {selectedOperation?.arrival_assurance?.quality_label || '待评估'}
                      </p>
                    </div>
                    <div className="grid gap-2 text-sm sm:grid-cols-3">
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">推荐可停</p>
                        <p className="mt-1 font-semibold text-slate-950">
                          {selectedOperation?.arrival_assurance?.recommendation_probability === null || selectedOperation?.arrival_assurance?.recommendation_probability === undefined
                            ? '待计算'
                            : `${selectedOperation.arrival_assurance.recommendation_probability}%`}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">数据新鲜度</p>
                        <p className="mt-1 font-semibold text-slate-950">
                          {selectedOperation?.arrival_assurance?.signal_age_hours === null || selectedOperation?.arrival_assurance?.signal_age_hours === undefined
                            ? '暂无'
                            : `${selectedOperation.arrival_assurance.signal_age_hours} 小时`}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">到场风险</p>
                        <p className="mt-1 font-semibold text-slate-950">
                          {selectedOperation?.arrival_assurance?.risk?.label || '待判断'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">坐标/导航</p>
                        <p className="mt-1 font-semibold text-slate-950">
                          {selectedOperation?.arrival_assurance?.has_coordinates ? '已具备' : '待核验'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">收费规则</p>
                        <p className="mt-1 font-semibold text-slate-950">
                          {selectedOperation?.arrival_assurance?.has_fee_rule ? '已标注' : '待补充'}
                        </p>
                      </div>
                    </div>
                  </div>
                  {selectedOperation?.arrival_assurance?.alternatives?.length > 0 && (
                    <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
                      备选承接：{selectedOperation.arrival_assurance.alternatives.slice(0, 2).map((candidate) => `${candidate.name}（可停 ${candidate.probability}%）`).join('、')}。
                    </div>
                  )}
                  {selectedOperation?.arrival_assurance?.missing_fields?.length > 0 && (
                    <p className="mt-3 text-sm text-slate-500">
                      待补字段：{selectedOperation.arrival_assurance.missing_fields.join('、')}。这些字段会影响用户端可停概率和到场风险。
                    </p>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-950">AI 识别事件</h3>
                    <p className="text-sm text-slate-500">保存标准 JSON 提交记录，并用于更新停车位占用状态。</p>
                  </div>
                  {loadingInference && <LoadingSpinner size="small" text="加载事件..." />}
                </div>

                {selectedInferenceEvents.length === 0 ? (
                  <div className="px-5 py-8 text-sm text-slate-500">
                    暂无 AI 识别事件。可向 `/api/admin/inference-events` 提交样例 JSON 验证链路。
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {selectedInferenceEvents.slice(0, 5).map((event) => (
                      <article key={event.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_0.7fr_0.7fr_0.8fr] md:items-center">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-950">{event.model_name || 'unknown model'}</h4>
                          <p className="mt-1 text-xs text-slate-500">
                            {event.camera_name || event.camera_external_id || '未绑定摄像头来源'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-700">{event.total_slots} 个检测车位</p>
                          <p className="mt-1 text-xs text-slate-500">本次 JSON 范围</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-700">
                            {event.occupied_count} 占用 / {event.vacant_count} 空闲
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            平均置信度 {event.average_confidence ? Number(event.average_confidence).toFixed(2) : '暂无'}
                          </p>
                        </div>
                        <div className="text-sm text-slate-500">
                          {formatTimestamp(event.created_at)}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-950">摄像头 / 视频源目录</h3>
                    <p className="text-sm text-slate-500">记录校园试点视频、图片采样或公共数据占位来源，为后续 AI 推理绑定输入。</p>
                  </div>
                  {loadingCameras && <LoadingSpinner size="small" text="加载来源..." />}
                </div>

                {selectedCameraSources.length === 0 ? (
                  <div className="px-5 py-8 text-sm text-slate-500">
                    暂无关联来源。可通过 `npm run import:camera-sources -- ../../data/campus_camera_sources_demo.csv` 导入样例。
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {selectedCameraSources.map((camera) => (
                      <article key={camera.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[1.1fr_0.7fr_0.8fr_1.2fr] lg:items-center">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-semibold text-slate-950">{camera.name}</h4>
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getCameraStatusClassName(camera.status)}`}>
                              {cameraStatusLabels[camera.status] || camera.status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{camera.camera_external_id}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-700">
                            {cameraKindLabels[camera.source_kind] || camera.source_kind}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {camera.ai_pipeline || '未绑定 AI 流程'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-slate-700">{formatTimestamp(camera.last_seen_at)}</p>
                          <p className="mt-1 text-xs text-slate-500">最近采样</p>
                        </div>
                        <div>
                          <p className="text-sm text-slate-700">{camera.coverage_description || '暂无覆盖范围'}</p>
                          <p className="mt-1 break-all text-xs text-slate-500">{camera.source_url || '暂无来源地址'}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-950">车位明细</h3>
                      <p className="text-sm text-slate-500">查看 AI 或导入流程写入的每个车位占用状态。</p>
                    </div>
                    {loadingStatus && <LoadingSpinner size="small" text="刷新中..." />}
                  </div>

                  <div className="max-h-[520px] overflow-y-auto">
                    {visibleSlots.length === 0 ? (
                      <div className="px-5 py-12 text-center text-sm text-slate-500">暂无车位明细</div>
                    ) : (
                      <table className="min-w-full divide-y divide-slate-100">
                        <thead className="sticky top-0 bg-slate-50">
                          <tr>
                            <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">车位</th>
                            <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">状态</th>
                            <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">预测空出</th>
                            <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">更新时间</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {visibleSlots.map((slot) => (
                            <tr key={slot.id} className="hover:bg-slate-50">
                              <td className="whitespace-nowrap px-5 py-3 text-sm font-medium text-slate-950">
                                {slot.slot_number}
                              </td>
                              <td className="whitespace-nowrap px-5 py-3 text-sm">
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                                    slot.is_occupied
                                      ? 'border-red-200 bg-red-50 text-red-700'
                                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  }`}
                                >
                                  {slot.is_occupied ? '已占用' : '空闲'}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-600">
                                {slot.is_occupied ? formatDuration(slot.predicted_vacancy_seconds) : '当前空闲'}
                              </td>
                              <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-500">
                                {formatTimestamp(slot.updated_at || slot.last_status_change)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                <aside className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <AlertTriangle className="h-5 w-5 text-orange-700" />
                      预警规则
                    </div>
                    <div className="mt-4 space-y-3 text-sm text-slate-600">
                      <p>占用率 90% 及以上：满位预警。</p>
                      <p>占用率 75% 至 90%：高占用。</p>
                      <p>占用率低于 75%：常规监测。</p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <Database className="h-5 w-5 text-blue-700" />
                      扩展字段
                    </div>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div>
                        <dt className="text-slate-500">收费规则</dt>
                        <dd className="mt-1 text-slate-800">{selectedMetadata.fee_rule || '暂无'}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">数据来源</dt>
                        <dd className="mt-1 text-slate-800">
                          {sourceLabels[selectedMetadata.source_type] || selectedMetadata.source_type || '演示数据'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">备注</dt>
                        <dd className="mt-1 text-slate-800">{selectedMetadata.notes || '暂无'}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">ROI 来源</dt>
                        <dd className="mt-1 text-slate-800">
                          {roiCameraSources.length > 0 ? roiCameraSources.join('、') : '暂无 ROI CSV 标注'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </aside>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default AdminLotStatus;
