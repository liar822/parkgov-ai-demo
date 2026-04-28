import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Database,
  Edit3,
  ExternalLink,
  FileText,
  MapPin,
  ParkingCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Signal,
  Trash2,
  Video
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { adminService, parkingService } from '../services/api';
import LoadingSpinner from './LoadingSpinner';

const emptyForm = {
  name: '',
  total_slots: 1,
  video_url: '',
  is_active: true,
  rows: 1,
  columns: 1,
  slot_width: 2.5,
  slot_height: 5.0
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
  if (rate >= 90) return 'border-red-200 bg-red-50 text-red-700';
  if (rate >= 75) return 'border-orange-200 bg-orange-50 text-orange-700';
  if (rate >= 50) return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
};

const getAlertTone = (level) => {
  if (level === 'critical') return 'border-red-200 bg-red-50 text-red-700';
  if (level === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-zinc-200 bg-zinc-50 text-zinc-600';
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

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const AdminLots = () => {
  const [lots, setLots] = useState([]);
  const [operations, setOperations] = useState([]);
  const [selectedLotId, setSelectedLotId] = useState('');
  const [slots, setSlots] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loadingLots, setLoadingLots] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedLot = useMemo(
    () => lots.find((lot) => String(lot.id) === String(selectedLotId)) || null,
    [lots, selectedLotId]
  );

  const operationsByLotId = useMemo(() => {
    return operations.reduce((accumulator, operation) => {
      accumulator[String(operation.id)] = operation;
      return accumulator;
    }, {});
  }, [operations]);

  const selectedOperation = selectedLot ? operationsByLotId[String(selectedLot.id)] : null;
  const selectedStats = getLotStats(selectedLot);
  const selectedMetadata = getMetadata(selectedLot);
  const occupiedSlots = slots.filter((slot) => slot.is_occupied);

  const loadLots = async () => {
    setLoadingLots(true);
    setError('');

    try {
      const [lotsResponse, operationsResponse] = await Promise.all([
        parkingService.getAllParkingLots(),
        adminService.getParkingOperations()
      ]);

      const nextLots = lotsResponse.data?.data?.parking_lots || lotsResponse.data?.data || [];
      const nextOperations = operationsResponse.data?.data?.parking_operations || [];

      setLots(nextLots);
      setOperations(nextOperations);
      setSelectedLotId((current) => {
        if (current && nextLots.some((lot) => String(lot.id) === String(current))) {
          return current;
        }
        return nextLots[0] ? String(nextLots[0].id) : '';
      });
    } catch (requestError) {
      setLots([]);
      setOperations([]);
      setError(requestError.response?.data?.error || requestError.message || '停车场档案加载失败');
    } finally {
      setLoadingLots(false);
    }
  };

  const loadLotStatus = async (lotId) => {
    if (!lotId) {
      setSlots([]);
      return;
    }

    setLoadingSlots(true);

    try {
      const response = await parkingService.getParkingStatus(lotId);
      if (response.data?.success) {
        setSlots(response.data.data.slots || []);
      }
    } catch (requestError) {
      setSlots([]);
      toast.error(requestError.response?.data?.error || requestError.message || '车位状态加载失败');
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    loadLots();
  }, []);

  useEffect(() => {
    if (!selectedLot) {
      setForm(emptyForm);
      setSlots([]);
      return;
    }

    setForm({
      name: selectedLot.name || '',
      total_slots: toNumber(selectedLot.total_slots, 1),
      video_url: selectedLot.video_url || '',
      is_active: !!selectedLot.is_active,
      rows: toNumber(selectedLot.slot_configuration?.rows, 1),
      columns: toNumber(selectedLot.slot_configuration?.columns, 1),
      slot_width: toNumber(selectedLot.slot_configuration?.slot_width, 2.5),
      slot_height: toNumber(selectedLot.slot_configuration?.slot_height, 5.0)
    });
    loadLotStatus(selectedLot.id);
  }, [selectedLot?.id]);

  const sourceOptions = useMemo(() => {
    return Array.from(
      new Set(lots.map((lot) => getMetadata(lot).source_type).filter(Boolean))
    ).sort();
  }, [lots]);

  const filteredLots = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return lots
      .map((lot) => {
        const metadata = getMetadata(lot);
        const operation = operationsByLotId[String(lot.id)] || null;
        const stats = getLotStats(lot);

        return { ...lot, metadata, operation, stats };
      })
      .filter((lot) => {
        const sourceType = lot.metadata.source_type || 'unknown';
        const matchesSource = sourceFilter === 'all' || sourceType === sourceFilter;
        const matchesStatus = (() => {
          if (statusFilter === 'all') return true;
          if (statusFilter === 'high') return lot.stats.occupancyRate >= 75;
          if (statusFilter === 'warning') return (lot.operation?.alerts || []).length > 0;
          if (statusFilter === 'no_ai') return !lot.operation?.inference?.latest_event_at;
          if (statusFilter === 'roi_missing') return Number(lot.operation?.roi?.roi_coverage_rate || 0) < 80;
          return true;
        })();
        const haystack = [
          lot.name,
          lot.metadata.district,
          lot.metadata.address,
          lot.metadata.fee_rule,
          lot.metadata.source_type,
          lot.metadata.source_external_id
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return matchesSource && matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
      })
      .sort((first, second) => second.stats.occupancyRate - first.stats.occupancyRate || first.name.localeCompare(second.name));
  }, [lots, operationsByLotId, searchQuery, sourceFilter, statusFilter]);

  const summary = useMemo(() => {
    const totalLots = lots.length;
    const totalSlots = lots.reduce((sum, lot) => sum + getLotStats(lot).total, 0);
    const occupiedSlotsCount = lots.reduce((sum, lot) => sum + getLotStats(lot).occupied, 0);
    const availableSlots = Math.max(totalSlots - occupiedSlotsCount, 0);
    const alerts = operations.reduce((sum, operation) => sum + (operation.alerts?.length || 0), 0);
    const roiReady = operations.filter((operation) => Number(operation.roi?.roi_coverage_rate || 0) >= 80).length;
    const cameraReady = operations.filter((operation) => Number(operation.camera?.camera_source_count || 0) > 0).length;
    const latestInference = operations
      .map((operation) => operation.inference?.latest_event_at)
      .filter(Boolean)
      .sort((first, second) => new Date(second) - new Date(first))[0];

    return {
      totalLots,
      totalSlots,
      availableSlots,
      occupancyRate: totalSlots > 0 ? Math.round((occupiedSlotsCount / totalSlots) * 1000) / 10 : 0,
      alerts,
      roiReady,
      cameraReady,
      latestInference
    };
  }, [lots, operations]);

  const handleRefresh = async () => {
    await loadLots();
    if (selectedLotId) {
      await loadLotStatus(selectedLotId);
    }
    toast.success('停车场档案已刷新');
  };

  const validateForm = () => {
    if (!form.name.trim()) {
      toast.error('请填写停车场名称');
      return false;
    }
    if (toNumber(form.total_slots) <= 0) {
      toast.error('总车位必须大于 0');
      return false;
    }
    if (toNumber(form.rows) <= 0 || toNumber(form.columns) <= 0) {
      toast.error('行列数必须大于 0');
      return false;
    }
    return true;
  };

  const buildLotPayload = ({ preserveMetadata = false } = {}) => {
    const slotConfiguration = {
      ...(preserveMetadata ? selectedLot?.slot_configuration || {} : {}),
      rows: parseInt(form.rows, 10) || 1,
      columns: parseInt(form.columns, 10) || 1,
      slot_width: parseFloat(form.slot_width) || 2.5,
      slot_height: parseFloat(form.slot_height) || 5.0
    };

    return {
      name: form.name.trim(),
      total_slots: parseInt(form.total_slots, 10) || 1,
      video_url: form.video_url || '',
      is_active: Boolean(form.is_active),
      slot_configuration: slotConfiguration
    };
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setActionLoading(true);
    try {
      if (selectedLot) {
        await adminService.updateParkingLot(selectedLot.id, buildLotPayload({ preserveMetadata: true }));
        toast.success('停车场档案已更新');
      } else {
        const payload = buildLotPayload();
        await adminService.createParkingLot({
          name: payload.name,
          total_slots: payload.total_slots,
          video_url: payload.video_url || undefined,
          slot_configuration: payload.slot_configuration
        });
        toast.success('停车场已创建');
      }
      await loadLots();
    } catch (requestError) {
      const message = requestError.response?.data?.details || requestError.response?.data?.error || requestError.message || '保存失败';
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedLot) return;
    if (!window.confirm(`确认删除“${selectedLot.name}”？这会移除该停车场及其车位记录。`)) return;

    setActionLoading(true);
    try {
      await adminService.deleteParkingLot(selectedLot.id);
      toast.success('停车场已删除');
      setSelectedLotId('');
      await loadLots();
    } catch (requestError) {
      toast.error(requestError.response?.data?.error || requestError.message || '删除失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReleaseSlot = async (slot) => {
    if (!window.confirm(`确认释放 ${slot.slot_number} 号车位？`)) return;

    setActionLoading(true);
    try {
      await parkingService.releaseSlot(slot.id);
      toast.success(`${slot.slot_number} 号车位已释放`);
      await Promise.all([loadLotStatus(selectedLot.id), loadLots()]);
    } catch (requestError) {
      toast.error(requestError.response?.data?.error || requestError.message || '释放失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReleaseAllOccupied = async () => {
    if (!selectedLot || occupiedSlots.length === 0) return;
    if (!window.confirm(`确认释放“${selectedLot.name}”的 ${occupiedSlots.length} 个占用车位？`)) return;

    setActionLoading(true);
    try {
      for (const slot of occupiedSlots) {
        await parkingService.releaseSlot(slot.id);
      }
      toast.success('占用车位已批量释放');
      await Promise.all([loadLotStatus(selectedLot.id), loadLots()]);
    } catch (requestError) {
      toast.error(requestError.response?.data?.error || requestError.message || '批量释放失败');
    } finally {
      setActionLoading(false);
    }
  };

  const startNewLot = () => {
    setSelectedLotId('');
    setSlots([]);
    setForm(emptyForm);
  };

  const summaryCards = [
    { label: '停车场档案', value: summary.totalLots, note: '当前启用清单', icon: ParkingCircle, tone: 'text-zinc-950' },
    { label: '总车位', value: summary.totalSlots, note: '数据库车位明细汇总', icon: Database, tone: 'text-zinc-950' },
    { label: '剩余车位', value: summary.availableSlots, note: '面向用户端展示', icon: CheckCircle2, tone: 'text-emerald-700' },
    { label: '平均占用率', value: `${summary.occupancyRate}%`, note: '按车位明细计算', icon: Signal, tone: 'text-amber-700' },
    { label: 'ROI 达标', value: `${summary.roiReady}/${summary.totalLots}`, note: '覆盖率达到 80%', icon: Video, tone: 'text-blue-700' },
    { label: '风险提示', value: summary.alerts, note: '来自运维聚合接口', icon: AlertTriangle, tone: summary.alerts > 0 ? 'text-red-700' : 'text-zinc-950' }
  ];

  return (
    <div className="space-y-6 text-zinc-950">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Parking Asset Registry</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-950">停车场档案管理</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            维护校园试点和开放数据样例停车场的基础档案、车位规模、视频源入口与 AI 覆盖情况。正式上线前，真实来源、许可和部署边界仍需逐项核验。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/parking-lots"
            className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            <ExternalLink className="mr-1.5 h-4 w-4" />
            查看用户端
          </Link>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loadingLots || actionLoading}
            className="inline-flex items-center rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loadingLots ? 'animate-spin' : ''}`} />
            刷新档案
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-zinc-500">{card.label}</p>
                <Icon className="h-4 w-4 text-zinc-400" />
              </div>
              <p className={`mt-3 text-3xl font-semibold ${card.tone}`}>{card.value}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{card.note}</p>
            </div>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索停车场、区域、地址、收费或外部编号"
                className="form-input pl-9"
              />
            </label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="form-input"
            >
              <option value="all">全部状态</option>
              <option value="high">高占用</option>
              <option value="warning">有风险提示</option>
              <option value="no_ai">暂无 AI 事件</option>
              <option value="roi_missing">ROI 不足</option>
            </select>
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="form-input"
            >
              <option value="all">全部来源</option>
              {sourceOptions.map((sourceType) => (
                <option key={sourceType} value={sourceType}>
                  {sourceLabels[sourceType] || sourceType}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-zinc-950">停车场清单</h2>
                <p className="text-sm text-zinc-500">按占用率排序，点击后在右侧维护档案和车位状态。</p>
              </div>
              {loadingLots && <LoadingSpinner size="small" text="加载..." />}
            </div>

            {loadingLots ? (
              <div className="flex min-h-[360px] items-center justify-center">
                <LoadingSpinner text="正在加载停车场档案..." />
              </div>
            ) : filteredLots.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-zinc-500">暂无匹配停车场</div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {filteredLots.map((lot) => {
                  const active = String(lot.id) === String(selectedLotId);
                  const sourceType = lot.metadata.source_type || 'unknown';
                  const alerts = lot.operation?.alerts || [];
                  const roiRate = Number(lot.operation?.roi?.roi_coverage_rate || 0);

                  return (
                    <button
                      key={lot.id}
                      type="button"
                      onClick={() => setSelectedLotId(String(lot.id))}
                      className={`block w-full px-5 py-4 text-left transition ${
                        active ? 'bg-zinc-950 text-white' : 'bg-white hover:bg-zinc-50'
                      }`}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className={`text-base font-semibold ${active ? 'text-white' : 'text-zinc-950'}`}>{lot.name}</h3>
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                              active ? 'border-white/20 bg-white/10 text-white' : getOccupancyTone(lot.stats.occupancyRate)
                            }`}>
                              占用 {lot.stats.occupancyRate}%
                            </span>
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                              active ? 'border-white/20 bg-white/10 text-white' : 'border-zinc-200 bg-zinc-50 text-zinc-600'
                            }`}>
                              {sourceLabels[sourceType] || sourceType}
                            </span>
                          </div>
                          <p className={`mt-2 text-sm ${active ? 'text-zinc-300' : 'text-zinc-600'}`}>
                            {lot.metadata.district || '未标注区域'} · {lot.metadata.address || '暂无地址'} · {lot.metadata.fee_rule || '暂无收费规则'}
                          </p>
                          <div className={`mt-3 flex flex-wrap gap-2 text-xs ${active ? 'text-zinc-300' : 'text-zinc-500'}`}>
                            <span>ROI {roiRate}%</span>
                            <span>摄像头/样例源 {lot.operation?.camera?.camera_source_count || 0}</span>
                            <span>最近 AI {formatTimestamp(lot.operation?.inference?.latest_event_at)}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-center lg:min-w-[260px]">
                          <div>
                            <p className={`text-xl font-semibold ${active ? 'text-white' : 'text-zinc-950'}`}>{lot.stats.total}</p>
                            <p className={`text-xs ${active ? 'text-zinc-400' : 'text-zinc-500'}`}>总车位</p>
                          </div>
                          <div>
                            <p className={`text-xl font-semibold ${active ? 'text-emerald-200' : 'text-emerald-700'}`}>{lot.stats.available}</p>
                            <p className={`text-xs ${active ? 'text-zinc-400' : 'text-zinc-500'}`}>剩余</p>
                          </div>
                          <div>
                            <p className={`text-xl font-semibold ${alerts.length > 0 ? (active ? 'text-amber-200' : 'text-red-700') : (active ? 'text-white' : 'text-zinc-950')}`}>
                              {alerts.length}
                            </p>
                            <p className={`text-xs ${active ? 'text-zinc-400' : 'text-zinc-500'}`}>提示</p>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-zinc-950">{selectedLot ? '档案维护' : '新建停车场'}</h2>
                <p className="text-sm text-zinc-500">
                  {selectedLot ? '编辑基础字段，来源元数据由导入脚本维护。' : '用于补充校园试点或临时演示停车场。'}
                </p>
              </div>
              <button
                type="button"
                onClick={startNewLot}
                className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                新建
              </button>
            </div>

            <div className="space-y-4 p-5">
              {selectedLot && (
                <div className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-zinc-500">总 / 剩余</p>
                    <p className="mt-1 text-lg font-semibold text-zinc-950">{selectedStats.total} / {selectedStats.available}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">ROI 覆盖</p>
                    <p className="mt-1 text-lg font-semibold text-blue-700">{selectedOperation?.roi?.roi_coverage_rate || 0}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">最近 AI</p>
                    <p className="mt-1 text-sm font-medium text-zinc-950">{formatTimestamp(selectedOperation?.inference?.latest_event_at)}</p>
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="block text-sm font-medium text-zinc-700">停车场名称</span>
                  <input
                    className="form-input mt-1"
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </label>
                <label>
                  <span className="block text-sm font-medium text-zinc-700">总车位</span>
                  <input
                    className="form-input mt-1"
                    type="number"
                    min="1"
                    value={form.total_slots}
                    onChange={(event) => setForm({ ...form, total_slots: parseInt(event.target.value, 10) || 1 })}
                  />
                </label>
                <label className="sm:col-span-2">
                  <span className="block text-sm font-medium text-zinc-700">视频源 URL</span>
                  <input
                    className="form-input mt-1"
                    value={form.video_url}
                    onChange={(event) => setForm({ ...form, video_url: event.target.value })}
                    placeholder="可为空，真实摄像头接入前建议使用样例视频或文件路径说明"
                  />
                </label>
                <label>
                  <span className="block text-sm font-medium text-zinc-700">布局行数</span>
                  <input
                    className="form-input mt-1"
                    type="number"
                    min="1"
                    value={form.rows}
                    onChange={(event) => setForm({ ...form, rows: parseInt(event.target.value, 10) || 1 })}
                  />
                </label>
                <label>
                  <span className="block text-sm font-medium text-zinc-700">布局列数</span>
                  <input
                    className="form-input mt-1"
                    type="number"
                    min="1"
                    value={form.columns}
                    onChange={(event) => setForm({ ...form, columns: parseInt(event.target.value, 10) || 1 })}
                  />
                </label>
                <label>
                  <span className="block text-sm font-medium text-zinc-700">车位宽度 m</span>
                  <input
                    className="form-input mt-1"
                    type="number"
                    step="0.1"
                    value={form.slot_width}
                    onChange={(event) => setForm({ ...form, slot_width: parseFloat(event.target.value) || 2.5 })}
                  />
                </label>
                <label>
                  <span className="block text-sm font-medium text-zinc-700">车位长度 m</span>
                  <input
                    className="form-input mt-1"
                    type="number"
                    step="0.1"
                    value={form.slot_height}
                    onChange={(event) => setForm({ ...form, slot_height: parseFloat(event.target.value) || 5.0 })}
                  />
                </label>
                {selectedLot && (
                  <label>
                    <span className="block text-sm font-medium text-zinc-700">启用状态</span>
                    <select
                      className="form-input mt-1"
                      value={form.is_active ? '1' : '0'}
                      onChange={(event) => setForm({ ...form, is_active: event.target.value === '1' })}
                    >
                      <option value="1">启用</option>
                      <option value="0">停用</option>
                    </select>
                  </label>
                )}
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                说明：CSV/开放数据导入的区域、地址、收费和来源编号会保存在元数据中；这里编辑布局字段不会自动补建历史车位明细。
              </div>

              {selectedLot && (
                <div className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
                  <p className="inline-flex items-center gap-2"><MapPin className="h-4 w-4 text-zinc-400" />{selectedMetadata.district || '未标注区域'}</p>
                  <p className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-zinc-400" />{selectedMetadata.fee_rule || '暂无收费规则'}</p>
                  <p className="inline-flex items-center gap-2 sm:col-span-2"><Database className="h-4 w-4 text-zinc-400" />{sourceLabels[selectedMetadata.source_type] || selectedMetadata.source_type || '暂无来源标签'}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={actionLoading}
                  className="inline-flex items-center rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="mr-1.5 h-4 w-4" />
                  {actionLoading ? '保存中...' : selectedLot ? '保存档案' : '创建停车场'}
                </button>
                {selectedLot && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={actionLoading}
                    className="inline-flex items-center rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    删除
                  </button>
                )}
              </div>
            </div>
          </div>

          {selectedLot && (
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
                <div>
                  <h2 className="font-semibold text-zinc-950">车位状态</h2>
                  <p className="text-sm text-zinc-500">当前 {slots.length} 个车位，{occupiedSlots.length} 个占用。</p>
                </div>
                <button
                  type="button"
                  onClick={handleReleaseAllOccupied}
                  disabled={actionLoading || occupiedSlots.length === 0}
                  className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                  批量释放
                </button>
              </div>

              {loadingSlots ? (
                <div className="flex min-h-[260px] items-center justify-center">
                  <LoadingSpinner text="正在加载车位状态..." />
                </div>
              ) : (
                <div className="p-5">
                  <div className="grid max-h-52 grid-cols-8 gap-2 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-10 lg:grid-cols-12">
                    {slots.length === 0 ? (
                      <div className="col-span-full py-8 text-center text-sm text-zinc-500">暂无车位明细</div>
                    ) : (
                      slots.map((slot) => (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => slot.is_occupied && handleReleaseSlot(slot)}
                          disabled={actionLoading || !slot.is_occupied}
                          title={`${slot.slot_number} 号车位：${slot.is_occupied ? '占用' : '空闲'}`}
                          className={`aspect-square rounded-md border text-[11px] font-semibold transition ${
                            slot.is_occupied
                              ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          } disabled:cursor-default`}
                        >
                          {slot.slot_number}
                        </button>
                      ))
                    )}
                  </div>

                  <div className="mt-4 space-y-2">
                    {selectedOperation?.alerts?.length > 0 ? (
                      selectedOperation.alerts.map((alert) => (
                        <div key={`${alert.code}-${alert.message}`} className={`flex gap-2 rounded-lg border px-3 py-2 text-xs leading-5 ${getAlertTone(alert.level)}`}>
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                          <span>{alert.message}</span>
                        </div>
                      ))
                    ) : (
                      <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none" />
                        <span>当前没有运维风险提示。</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <p className="flex items-center gap-2 text-xs text-zinc-500"><Camera className="h-4 w-4" />摄像头/样例源</p>
                      <p className="mt-2 text-lg font-semibold text-zinc-950">{selectedOperation?.camera?.camera_source_count || 0}</p>
                      <p className="mt-1 text-xs text-zinc-500">在线 {selectedOperation?.camera?.online_count || 0} · 样例 {selectedOperation?.camera?.sample_count || 0}</p>
                    </div>
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <p className="flex items-center gap-2 text-xs text-zinc-500"><Clock className="h-4 w-4" />开放数据快照</p>
                      <p className="mt-2 text-sm font-semibold text-zinc-950">{formatTimestamp(selectedOperation?.open_data?.latest_observed_at)}</p>
                      <p className="mt-1 text-xs text-zinc-500">{selectedOperation?.open_data?.latest_source_key || '暂无来源'}</p>
                    </div>
                    <div className="rounded-lg border border-zinc-200 p-3 sm:col-span-2">
                      <p className="flex items-center gap-2 text-xs text-zinc-500"><Video className="h-4 w-4" />AI 识别事件</p>
                      <p className="mt-2 text-sm font-semibold text-zinc-950">
                        {selectedOperation?.inference?.latest_model_name || '暂无模型记录'} · {formatTimestamp(selectedOperation?.inference?.latest_event_at)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        识别 {selectedOperation?.inference?.latest_total_slots ?? '未知'} 个车位，置信度 {selectedOperation?.inference?.latest_average_confidence ?? '未知'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </section>
    </div>
  );
};

export default AdminLots;
