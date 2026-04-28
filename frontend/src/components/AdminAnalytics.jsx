import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  Map,
  ParkingCircle,
  RefreshCw,
  ShieldCheck,
  Signal,
  Video
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { adminService } from '../services/api';
import LoadingSpinner from './LoadingSpinner';

const formatNumber = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '0';
  return new Intl.NumberFormat('zh-CN').format(numericValue);
};

const formatPercent = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '0%';
  return `${Math.round(numericValue * 10) / 10}%`;
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

const formatDateLabel = (value) => {
  if (!value) return '未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
};

const getMetadata = (lot) => lot?.slot_configuration?.metadata || {};

const EmptyChart = ({ icon: Icon = BarChart3, text }) => (
  <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50 text-center">
    <div>
      <Icon className="mx-auto h-8 w-8 text-zinc-400" />
      <p className="mt-3 text-sm text-zinc-500">{text}</p>
    </div>
  </div>
);

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-zinc-950">{label}</p>
      <div className="mt-1 space-y-1">
        {payload.map((entry) => (
          <p key={entry.dataKey} className="text-zinc-600">
            <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            {entry.name}: {entry.dataKey?.includes('rate') || entry.name?.includes('率') ? formatPercent(entry.value) : formatNumber(entry.value)}
          </p>
        ))}
      </div>
    </div>
  );
};

const AdminAnalytics = () => {
  const [systemAnalytics, setSystemAnalytics] = useState(null);
  const [operations, setOperations] = useState([]);
  const [operationsSummary, setOperationsSummary] = useState(null);
  const [governanceSummary, setGovernanceSummary] = useState(null);
  const [dataSources, setDataSources] = useState([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadAnalytics = async ({ showRefreshing = false } = {}) => {
    if (showRefreshing) setRefreshing(true);
    setLoading((current) => current || !showRefreshing);
    setError('');

    try {
      const [
        systemResponse,
        operationsResponse,
        governanceResponse,
        sourcesResponse
      ] = await Promise.allSettled([
        adminService.getSystemAnalytics(days),
        adminService.getParkingOperations(),
        adminService.getGovernanceSummary(),
        adminService.getDataSources()
      ]);

      if (systemResponse.status === 'fulfilled' && systemResponse.value.data?.success) {
        setSystemAnalytics(systemResponse.value.data.data || null);
      }
      if (operationsResponse.status === 'fulfilled' && operationsResponse.value.data?.success) {
        setOperations(operationsResponse.value.data.data.parking_operations || []);
        setOperationsSummary(operationsResponse.value.data.data.summary || null);
      }
      if (governanceResponse.status === 'fulfilled' && governanceResponse.value.data?.success) {
        setGovernanceSummary(governanceResponse.value.data.data || null);
      }
      if (sourcesResponse.status === 'fulfilled' && sourcesResponse.value.data?.success) {
        setDataSources(sourcesResponse.value.data.data.data_sources || []);
      }

      const failedCount = [systemResponse, operationsResponse, governanceResponse, sourcesResponse]
        .filter((response) => response.status === 'rejected').length;
      if (failedCount > 0) {
        setError('部分统计数据暂时不可用，页面已展示可读取指标。');
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || '统计报表加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, [days]);

  const handleRefresh = async () => {
    await loadAnalytics({ showRefreshing: true });
    toast.success('统计报表已刷新');
  };

  const dailyChartData = useMemo(() => {
    return [...(systemAnalytics?.daily_analytics || [])]
      .sort((first, second) => new Date(first.date) - new Date(second.date))
      .map((item) => ({
        date: formatDateLabel(item.date),
        occupancy_rate: Number(item.avg_occupancy_rate || 0),
        vehicles: Number(item.total_vehicles || 0)
      }));
  }, [systemAnalytics]);

  const districtChartData = useMemo(() => {
    return (governanceSummary?.districts || []).map((district) => ({
      name: district.district || '未标注区域',
      occupancy_rate: Number(district.occupancy_rate || 0),
      total_slots: Number(district.total_slots || 0),
      available_slots: Number(district.available_slots || 0),
      high_occupancy_lots: Number(district.high_occupancy_lots || 0)
    }));
  }, [governanceSummary]);

  const peakHourData = useMemo(() => {
    const fromGovernance = governanceSummary?.peak_hours || [];
    if (fromGovernance.length > 0) {
      return fromGovernance.map((hour) => ({
        hour: `${String(hour.hour).padStart(2, '0')}:00`,
        occupancy_rate: Number(hour.avg_occupancy_rate || 0),
        event_count: Number(hour.event_count || 0)
      }));
    }

    return (systemAnalytics?.hourly_analytics || []).map((hour) => ({
      hour: `${String(hour.hour).padStart(2, '0')}:00`,
      occupancy_rate: Number(hour.avg_occupancy_rate || 0),
      event_count: Number(hour.total_vehicles || 0)
    }));
  }, [governanceSummary, systemAnalytics]);

  const topLots = useMemo(() => {
    return [...operations]
      .sort((first, second) => Number(second.statistics?.occupancy_rate || 0) - Number(first.statistics?.occupancy_rate || 0))
      .slice(0, 5);
  }, [operations]);

  const alertLots = useMemo(() => {
    return operations
      .filter((lot) => lot.alerts?.length > 0)
      .slice(0, 6);
  }, [operations]);

  const sourceSummary = useMemo(() => {
    const p0Sources = dataSources.filter((source) => source.priority === 'P0').length;
    const requiresKey = dataSources.filter((source) => source.requires_key).length;
    const officialSources = dataSources.filter((source) => String(source.source_key || '').startsWith('beijing_')).length;
    const datasetSources = dataSources.filter((source) => String(source.category || '').includes('ai')).length;

    return { p0Sources, requiresKey, officialSources, datasetSources };
  }, [dataSources]);

  const aiReadyLots = operations.filter((lot) => lot.inference?.latest_event_at).length;
  const roiReadyLots = operations.filter((lot) => Number(lot.roi?.roi_coverage_rate || 0) >= 80).length;
  const cameraReadyLots = operations.filter((lot) => Number(lot.camera?.camera_source_count || 0) > 0).length;
  const totalLots = Number(operationsSummary?.total_lots || systemAnalytics?.overall_statistics?.total_lots || operations.length || 0);
  const totalSlots = Number(operationsSummary?.total_slots || systemAnalytics?.overall_statistics?.total_slots || 0);
  const availableSlots = Number(operationsSummary?.available_slots || Math.max(totalSlots - Number(operationsSummary?.occupied_slots || 0), 0));
  const occupancyRate = Number(operationsSummary?.occupancy_rate || systemAnalytics?.overall_statistics?.overall_occupancy_rate || 0);
  const latestInference = operations
    .map((lot) => lot.inference?.latest_event_at)
    .filter(Boolean)
    .sort((first, second) => new Date(second) - new Date(first))[0];

  const kpiCards = [
    {
      label: '停车场',
      value: totalLots,
      note: '当前演示档案',
      icon: ParkingCircle,
      tone: 'text-zinc-950'
    },
    {
      label: '总车位',
      value: formatNumber(totalSlots),
      note: '车位明细汇总',
      icon: Database,
      tone: 'text-zinc-950'
    },
    {
      label: '剩余车位',
      value: formatNumber(availableSlots),
      note: '用户端可展示余位',
      icon: CheckCircle2,
      tone: 'text-emerald-700'
    },
    {
      label: '整体占用率',
      value: formatPercent(occupancyRate),
      note: '按当前状态计算',
      icon: Signal,
      tone: occupancyRate >= 75 ? 'text-red-700' : 'text-amber-700'
    },
    {
      label: 'AI 闭环',
      value: `${aiReadyLots}/${totalLots}`,
      note: `最近识别 ${formatTimestamp(latestInference)}`,
      icon: Video,
      tone: 'text-blue-700'
    },
    {
      label: '数据源',
      value: dataSources.length,
      note: `${sourceSummary.requiresKey} 个仍需 Key`,
      icon: FileText,
      tone: 'text-zinc-950'
    }
  ];

  const conclusionItems = [
    {
      title: '高占用停车场优先治理',
      text: operationsSummary?.high_occupancy_lots
        ? `当前有 ${operationsSummary.high_occupancy_lots} 个停车场占用率超过 75%，适合作为诱导分流和巡查资源配置的重点。`
        : '当前演示数据未出现多个高占用停车场，后续需要补充高峰期样本。'
    },
    {
      title: 'AI 覆盖仍需补强',
      text: `${roiReadyLots}/${totalLots} 个停车场 ROI 覆盖达到 80%，${aiReadyLots}/${totalLots} 个停车场已有标准化 AI 识别事件。`
    },
    {
      title: '官方接口仍是后续重点',
      text: `当前登记 ${sourceSummary.officialSources} 个北京开放数据相关来源，其中 P0 来源 ${sourceSummary.p0Sources} 个；没有 userKey 时继续使用离线样例导入。`
    }
  ];

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <LoadingSpinner size="large" text="正在加载统计报表..." />
      </div>
    );
  }

  return (
    <div className="space-y-6 text-zinc-950">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Governance Analytics</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-950">统计报表与治理研判</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            汇总停车场余位、区域利用率、AI 识别闭环和开放数据状态，用于展示“校园试点 + 北京开放数据地图层”的治理分析价值。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="form-input w-36 text-sm"
          >
            <option value={7}>近 7 天</option>
            <option value={14}>近 14 天</option>
            <option value={30}>近 30 天</option>
            <option value={90}>近 90 天</option>
          </select>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新报表
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {error}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {kpiCards.map((card) => {
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

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="font-semibold text-zinc-950">近期开停强度趋势</h2>
                <p className="mt-1 text-sm text-zinc-500">来自系统日聚合表；没有历史样本时保持空态，避免伪造趋势。</p>
              </div>
              {dailyChartData.length > 0 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyChartData}>
                      <defs>
                        <linearGradient id="occupancyFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#71717a' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: '#71717a' }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="occupancy_rate"
                        name="占用率"
                        stroke="#2563eb"
                        fill="url(#occupancyFill)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyChart text="暂无日聚合趋势。后续跑入更多识别事件或导入快照后会形成趋势线。" />
              )}
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="font-semibold text-zinc-950">区域利用率比较</h2>
                <p className="mt-1 text-sm text-zinc-500">按 district 汇总停车场，识别高占用与资源错配的候选区域。</p>
              </div>
              {districtChartData.length > 0 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={districtChartData} layout="vertical" margin={{ left: 18 }}>
                      <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fontSize: 12, fill: '#71717a' }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12, fill: '#71717a' }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="occupancy_rate" name="区域占用率" radius={[0, 6, 6, 0]}>
                        {districtChartData.map((entry) => (
                          <Cell key={entry.name} fill={entry.occupancy_rate >= 75 ? '#dc2626' : entry.occupancy_rate >= 50 ? '#d97706' : '#059669'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyChart icon={Map} text="暂无区域汇总。需要停车场元数据中包含 district 字段。" />
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="font-semibold text-zinc-950">高峰时段雏形</h2>
                <p className="mt-1 text-sm text-zinc-500">优先使用 AI 识别事件统计；样本不足时仅作为演示信号。</p>
              </div>
              {peakHourData.length > 0 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={peakHourData}>
                      <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" />
                      <XAxis dataKey="hour" tick={{ fontSize: 12, fill: '#71717a' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: '#71717a' }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="occupancy_rate" name="时段占用率" fill="#2563eb" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyChart icon={Clock} text="暂无高峰统计。需要持续写入 inference_events 或 occupancy snapshots。" />
              )}
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="font-semibold text-zinc-950">高占用停车场</h2>
                <p className="mt-1 text-sm text-zinc-500">用于管理端预警和用户端推荐排序。</p>
              </div>
              {topLots.length === 0 ? (
                <div className="py-10 text-center text-sm text-zinc-500">暂无停车场状态</div>
              ) : (
                <div className="space-y-3">
                  {topLots.map((lot) => {
                    const metadata = getMetadata(lot);
                    const rate = Number(lot.statistics?.occupancy_rate || 0);
                    return (
                      <div key={lot.id} className="rounded-lg border border-zinc-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-zinc-950">{lot.name}</h3>
                            <p className="mt-1 text-xs text-zinc-500">{metadata.district || '未标注区域'} · {metadata.source_type || '未知来源'}</p>
                          </div>
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                            rate >= 75 ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          }`}>
                            {formatPercent(rate)}
                          </span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className={`h-full rounded-full ${rate >= 75 ? 'bg-red-600' : 'bg-emerald-600'}`}
                            style={{ width: `${Math.min(rate, 100)}%` }}
                          />
                        </div>
                        <p className="mt-2 text-xs text-zinc-500">
                          剩余 {formatNumber(lot.statistics?.available_slots)} / {formatNumber(lot.statistics?.total_slots)} 个车位
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <h2 className="font-semibold text-zinc-950">报表结论</h2>
            </div>
            <div className="mt-4 space-y-3">
              {conclusionItems.map((item) => (
                <div key={item.title} className="rounded-lg border border-zinc-200 p-3">
                  <p className="text-sm font-semibold text-zinc-950">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-600">{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-700" />
              <h2 className="font-semibold text-zinc-950">待处理风险</h2>
            </div>
            {alertLots.length === 0 ? (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                当前没有运维风险提示。
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {alertLots.map((lot) => (
                  <div key={lot.id} className="rounded-lg border border-zinc-200 p-3">
                    <p className="text-sm font-semibold text-zinc-950">{lot.name}</p>
                    <div className="mt-2 space-y-1">
                      {lot.alerts.slice(0, 2).map((alert) => (
                        <p key={`${lot.id}-${alert.code}`} className="text-xs leading-5 text-zinc-600">
                          {alert.message}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-700" />
              <h2 className="font-semibold text-zinc-950">数据边界</h2>
            </div>
            <div className="mt-4 space-y-3 text-xs leading-5 text-zinc-600">
              <p>当前报表混合使用校园 demo、北京开放数据样例、OSM 候选和 AI 数据集验证结果。</p>
              <p>没有官方 userKey 时，不展示为北京全量实时数据；没有真实摄像头网络接入时，不声明实时城市级视频感知。</p>
              <p>AI 数据集结果只用于验证识别链路和 JSON 写回闭环，正式试点还需要校园非敏感样例视频或现场授权数据。</p>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-zinc-950">建设进度</h2>
            <div className="mt-4 space-y-3">
              {[
                { label: '摄像头/样例源登记', value: cameraReadyLots, total: totalLots },
                { label: 'ROI 覆盖达标', value: roiReadyLots, total: totalLots },
                { label: 'AI 识别事件', value: aiReadyLots, total: totalLots },
                { label: 'AI 数据集来源', value: sourceSummary.datasetSources, total: dataSources.length || 1 }
              ].map((item) => {
                const rate = item.total > 0 ? Math.round((item.value / item.total) * 100) : 0;
                return (
                  <div key={item.label}>
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>{item.label}</span>
                      <span>{item.value}/{item.total}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100">
                      <div className="h-full rounded-full bg-zinc-950" style={{ width: `${Math.min(rate, 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
};

export default AdminAnalytics;
