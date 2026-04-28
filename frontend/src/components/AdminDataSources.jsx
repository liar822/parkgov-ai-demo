import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileKey2,
  KeyRound,
  Link,
  MapPin,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';
import { adminService } from '../services/api';
import LoadingSpinner from './LoadingSpinner';

const statusLabels = {
  not_imported: '未导入',
  running: '导入中',
  completed: '完成',
  completed_with_errors: '部分失败',
  failed: '失败'
};

const categoryLabels = {
  official_dynamic_parking: '官方动态余位',
  official_static_parking: '官方静态泊位',
  official_static_facility: '官方设施档案',
  official_fee_rules: '官方收费规则',
  district_archive_parking: '区级历史备案',
  open_map_poi: '开放地图 POI',
  ai_vision_dataset: 'AI 视觉数据',
  ai_vehicle_counting_dataset: 'AI 车辆计数',
  governance_aggregate_report: '治理统计报告',
  commercial_map_api: '商业地图 API'
};

const getStatusClassName = (status) => {
  switch (status) {
    case 'completed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'completed_with_errors':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'failed':
      return 'border-red-200 bg-red-50 text-red-700';
    case 'running':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    default:
      return 'border-zinc-200 bg-zinc-50 text-zinc-600';
  }
};

const priorityTone = {
  P0: 'border-zinc-950 bg-zinc-950 text-white',
  P1: 'border-blue-200 bg-blue-50 text-blue-700',
  P2: 'border-amber-200 bg-amber-50 text-amber-700',
  P3: 'border-zinc-200 bg-zinc-50 text-zinc-600'
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

const getSourcePriority = (sourceKey = '') => {
  if (sourceKey.startsWith('beijing_')) {
    return 0;
  }
  if (sourceKey.startsWith('osm_')) {
    return 1;
  }
  return 2;
};

const AdminDataSources = () => {
  const [dataSources, setDataSources] = useState([]);
  const [importJobs, setImportJobs] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadDataSources = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await adminService.getDataSources();
      setDataSources(response.data?.data?.data_sources || []);
    } catch (requestError) {
      setDataSources([]);
      setError(requestError.response?.data?.error || requestError.message || '数据源加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadImportJobs = async () => {
    setLoadingJobs(true);

    try {
      const response = await adminService.getOpenDataImportJobs({ limit: 80 });
      setImportJobs(response.data?.data?.import_jobs || []);
    } catch (requestError) {
      setImportJobs([]);
      setError(requestError.response?.data?.error || requestError.message || '导入任务加载失败');
    } finally {
      setLoadingJobs(false);
    }
  };

  const loadSnapshots = async () => {
    try {
      const response = await adminService.getOpenDataOccupancySnapshots({ limit: 20 });
      setSnapshots(response.data?.data?.occupancy_snapshots || []);
    } catch (_) {
      setSnapshots([]);
    }
  };

  const loadCandidates = async () => {
    try {
      const response = await adminService.getParkingLotCandidates({ limit: 20 });
      setCandidates(response.data?.data?.parking_lot_candidates || []);
    } catch (_) {
      setCandidates([]);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([loadDataSources(), loadImportJobs(), loadSnapshots(), loadCandidates()]);
  };

  useEffect(() => {
    handleRefresh();
  }, []);

  const categories = useMemo(() => {
    return Array.from(new Set(dataSources.map((source) => source.category).filter(Boolean))).sort();
  }, [dataSources]);

  const filteredSources = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return dataSources
      .filter((source) => {
        const matchesCategory = categoryFilter === 'all' || source.category === categoryFilter;
        const matchesPriority = priorityFilter === 'all' || source.priority === priorityFilter;
        const haystack = [
          source.source_key,
          source.name,
          source.provider,
          source.priority,
          source.category,
          source.access_method,
          source.license_or_terms,
          source.fit_for_project,
          source.next_action
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return matchesCategory && matchesPriority && (!normalizedQuery || haystack.includes(normalizedQuery));
      })
      .sort((first, second) => {
        return getSourcePriority(first.source_key) - getSourcePriority(second.source_key)
          || String(first.source_key).localeCompare(String(second.source_key));
      });
  }, [dataSources, query, categoryFilter, priorityFilter]);

  const filteredJobs = useMemo(() => {
    return importJobs.filter((job) => statusFilter === 'all' || job.status === statusFilter);
  }, [importJobs, statusFilter]);

  const summary = useMemo(() => {
    return dataSources.reduce(
      (accumulator, source) => {
        accumulator.total += 1;
        accumulator.requiresKey += source.requires_key ? 1 : 0;
        accumulator.externalRefs += Number(source.external_ref_count || 0);
        accumulator.snapshots += Number(source.snapshot_count || 0);
        accumulator.candidates += Number(source.candidate_count || 0);
        if (source.latest_import_status === 'failed' || source.latest_import_status === 'completed_with_errors') {
          accumulator.needsAttention += 1;
        }
        return accumulator;
      },
      {
        total: 0,
        requiresKey: 0,
        externalRefs: 0,
        snapshots: 0,
        candidates: 0,
        needsAttention: 0
      }
    );
  }, [dataSources]);

  const summaryCards = [
    {
      label: '已登记来源',
      value: summary.total,
      note: '官方、校园、OSM、AI 数据集',
      icon: Database,
      tone: 'text-zinc-950'
    },
    {
      label: '待申请 Key',
      value: summary.requiresKey,
      note: '北京公共数据在线 API 预留',
      icon: KeyRound,
      tone: 'text-amber-700'
    },
    {
      label: '外部编号',
      value: summary.externalRefs,
      note: '用于匹配正式停车场档案',
      icon: Link,
      tone: 'text-zinc-950'
    },
    {
      label: '余位快照',
      value: summary.snapshots,
      note: '离线样例与后续实时数据',
      icon: Download,
      tone: 'text-emerald-700'
    },
    {
      label: '候选 POI',
      value: summary.candidates,
      note: '仅作待核验空间补全',
      icon: MapPin,
      tone: 'text-blue-700'
    },
    {
      label: '需关注',
      value: summary.needsAttention,
      note: '导入失败或部分失败来源',
      icon: AlertTriangle,
      tone: summary.needsAttention > 0 ? 'text-red-700' : 'text-zinc-950'
    }
  ];

  const boundaryNotes = [
    '当前以 CSV/XLSX 离线导入、校园试点 demo、OSM 候选和 AI 数据集验证为主。',
    '没有 userKey 时不强依赖北京公共数据在线 API；取得官方 Key 后再接入定时拉取。',
    'OSM/Overpass 点位遵循 ODbL 署名要求，只作为候选资源，不等同于官方停车场清单。',
    'AI 视觉数据集用于训练和验证识别链路，不代表真实城市摄像头已接入。'
  ];

  return (
    <div className="space-y-6 text-zinc-950">
      <div className="grid gap-5 border-b border-zinc-200 pb-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Data Provenance Ledger</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-950">数据源可信台账</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            集中记录停车场档案、余位快照、开放地图候选点和 AI 训练数据的来源、许可边界、导入状态与后续接入动作，支撑演示时的可解释和可追溯。
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
              校园试点优先
            </span>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700">
              北京开放数据预留
            </span>
            <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-zinc-600">
              不声明全城实时接入
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <h2 className="text-sm font-semibold text-zinc-950">演示边界</h2>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading || loadingJobs}
              className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading || loadingJobs ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {boundaryNotes.map((note) => (
              <div key={note} className="flex gap-2 text-xs leading-5 text-zinc-600">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-700" />
                <span>{note}</span>
              </div>
            ))}
          </div>
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

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(380px,0.8fr)]">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_150px_220px]">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索来源名称、provider、source_key"
              className="form-input"
            />
            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value)}
              className="form-input"
            >
              <option value="all">全部优先级</option>
              <option value="P0">P0 核心</option>
              <option value="P1">P1 重要</option>
              <option value="P2">P2 扩展</option>
              <option value="P3">P3 备选</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="form-input"
            >
              <option value="all">全部类别</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {categoryLabels[category] || category}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-zinc-950">数据源清单</h2>
                <p className="text-sm text-zinc-500">官方开放数据、地图 POI、AI 数据集和治理统计来源。</p>
              </div>
              {loading && <LoadingSpinner size="small" text="加载..." />}
            </div>

            {loading ? (
              <div className="flex min-h-[320px] items-center justify-center">
                <LoadingSpinner text="正在加载数据源..." />
              </div>
            ) : filteredSources.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-zinc-500">暂无匹配数据源</div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {filteredSources.map((source) => (
                  <article key={source.id || source.source_key} className="px-5 py-4 transition hover:bg-zinc-50/70">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-zinc-950">{source.name}</h3>
                          {source.priority && (
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${priorityTone[source.priority] || 'border-zinc-200 bg-zinc-50 text-zinc-600'}`}>
                              {source.priority}
                            </span>
                          )}
                          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600">
                            {categoryLabels[source.category] || source.category || '未分类'}
                          </span>
                          {source.requires_key && (
                            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                              <KeyRound className="mr-1 h-3.5 w-3.5" />
                              需要 Key
                            </span>
                          )}
                        </div>
                        <p className="mt-1 font-mono text-xs text-zinc-500">{source.source_key}</p>
                        <p className="mt-2 text-sm text-zinc-600">{source.provider || '未知提供方'} · {source.access_method || '暂无接入方式'}</p>
                        <p className="mt-1 text-sm text-zinc-500">{source.license_or_terms || '暂无许可说明'}</p>
                        {source.fit_for_project && (
                          <p className="mt-2 text-sm text-zinc-700">
                            适用：{source.fit_for_project}
                          </p>
                        )}
                        {source.next_action && (
                          <p className="mt-1 text-sm text-zinc-500">
                            下一步：{source.next_action}
                          </p>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-3 text-center lg:min-w-[320px]">
                        <div>
                          <p className="text-xl font-semibold">{source.external_ref_count || 0}</p>
                          <p className="text-xs text-zinc-500">外部编号</p>
                        </div>
                        <div>
                          <p className="text-xl font-semibold">{source.snapshot_count || 0}</p>
                          <p className="text-xs text-zinc-500">快照</p>
                        </div>
                        <div>
                          <p className="text-xl font-semibold">{source.candidate_count || 0}</p>
                          <p className="text-xs text-zinc-500">候选点</p>
                        </div>
                        <div>
                          <p className="text-xl font-semibold">{source.latest_records_imported || 0}</p>
                          <p className="text-xs text-zinc-500">最近导入</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                      <span className={`rounded-full border px-2.5 py-1 font-medium ${getStatusClassName(source.latest_import_status)}`}>
                        {statusLabels[source.latest_import_status] || '未导入'}
                      </span>
                      <span className="inline-flex items-center text-zinc-500">
                        <Clock className="mr-1 h-4 w-4" />
                        {formatTimestamp(source.latest_import_completed_at || source.latest_import_started_at)}
                      </span>
                      {source.official_url && (
                        <a
                          href={source.official_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center text-blue-700 hover:text-blue-900"
                        >
                          <Link className="mr-1 h-4 w-4" />
                          官方来源
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-zinc-950">最近导入任务</h2>
                <p className="text-sm text-zinc-500">记录文件哈希、导入条数和失败数。</p>
              </div>
              {loadingJobs && <LoadingSpinner size="small" text="加载..." />}
            </div>

            <div className="border-b border-zinc-100 px-5 py-3">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="form-input"
              >
                <option value="all">全部任务状态</option>
                <option value="completed">完成</option>
                <option value="completed_with_errors">部分失败</option>
                <option value="failed">失败</option>
                <option value="running">导入中</option>
              </select>
            </div>

            {filteredJobs.length === 0 ? (
              <div className="px-5 py-8 text-sm text-zinc-500">暂无导入任务</div>
            ) : (
              <div className="max-h-[520px] divide-y divide-zinc-100 overflow-y-auto">
                {filteredJobs.map((job) => (
                  <article key={job.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-950">{job.data_source_name || job.source_key}</h3>
                        <p className="mt-1 text-xs text-zinc-500">{job.import_kind}</p>
                      </div>
                      <span className={`flex-none rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusClassName(job.status)}`}>
                        {statusLabels[job.status] || job.status}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                      <div>
                        <p className="text-lg font-semibold">{job.records_seen || 0}</p>
                        <p className="text-xs text-zinc-500">读取</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-emerald-700">{job.records_imported || 0}</p>
                        <p className="text-xs text-zinc-500">成功</p>
                      </div>
                      <div>
                        <p className={`text-lg font-semibold ${Number(job.records_failed || 0) > 0 ? 'text-red-700' : 'text-zinc-950'}`}>
                          {job.records_failed || 0}
                        </p>
                        <p className="text-xs text-zinc-500">失败</p>
                      </div>
                    </div>

                    <p className="mt-3 flex items-center text-xs text-zinc-500">
                      <FileKey2 className="mr-1 h-4 w-4 flex-none" />
                      <span className="truncate">{job.input_file || '暂无文件路径'}</span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {formatTimestamp(job.completed_at || job.started_at)}
                    </p>
                    {job.error_message && (
                      <p className="mt-2 flex items-start text-xs text-red-700">
                        <AlertTriangle className="mr-1 mt-0.5 h-4 w-4 flex-none" />
                        <span>{job.error_message}</span>
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-700" />
                <h2 className="font-semibold text-zinc-950">最新余位快照</h2>
              </div>
            </div>
            {snapshots.length === 0 ? (
              <div className="px-5 py-8 text-sm text-zinc-500">暂无余位快照。实时停车泊位导入后会出现在这里。</div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {snapshots.slice(0, 8).map((snapshot) => (
                  <article key={snapshot.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-950">
                          {snapshot.parking_lot_name || snapshot.external_id || '未匹配停车场'}
                        </h3>
                        <p className="mt-1 text-xs text-zinc-500">{snapshot.source_key}</p>
                      </div>
                      <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600">
                        {snapshot.availability_level || '无等级'}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-zinc-600">
                      剩余 {snapshot.available_spaces ?? '未知'} / {snapshot.total_spaces ?? '未知'} 泊位
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">{formatTimestamp(snapshot.observed_at)}</p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-blue-700" />
                <h2 className="font-semibold text-zinc-950">候选停车 POI</h2>
              </div>
              <p className="mt-1 text-sm text-zinc-500">来自 OSM/Overpass 等开放地图，仅作空间补全候选。</p>
            </div>
            {candidates.length === 0 ? (
              <div className="px-5 py-8 text-sm text-zinc-500">
                暂无候选 POI。运行 `npm run import:osm-candidates -- --dry-run` 可先预览海淀高校周边开放地图点位。
              </div>
            ) : (
              <div className="max-h-[420px] divide-y divide-zinc-100 overflow-y-auto">
                {candidates.slice(0, 12).map((candidate) => (
                  <article key={candidate.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-950">
                          {candidate.name || candidate.external_id}
                        </h3>
                        <p className="mt-1 text-xs text-zinc-500">{candidate.source_key} · {candidate.external_id}</p>
                      </div>
                      <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600">
                        {candidate.parking_type || 'parking'}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-600">
                      {Number(candidate.latitude).toFixed(5)}, {Number(candidate.longitude).toFixed(5)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      access: {candidate.access || '未知'} · fee: {candidate.fee || '未知'} · capacity: {candidate.capacity ?? '未知'}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
};

export default AdminDataSources;
