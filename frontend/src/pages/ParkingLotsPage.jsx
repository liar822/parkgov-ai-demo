import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  ExternalLink,
  Filter,
  Gauge,
  Layers,
  LocateFixed,
  LogIn,
  MapPin,
  Navigation,
  PanelRightOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  WalletCards,
  X
} from 'lucide-react';
import { parkingService } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import BrandMark, { CapabilityStrip, PilotBoundaryNote } from '../components/BrandMark';
import Chatbot from '../components/Chatbot';

const defaultMapStyleUrl = 'https://tiles.openfreemap.org/styles/positron';
const realMapEnabled = import.meta.env.VITE_ENABLE_REAL_MAP !== 'false';

const referenceLocation = {
  name: '北京高校试点参考点',
  latitude: 39.9929,
  longitude: 116.3103
};

const sourceLabels = {
  campus_demo: '校园试点 demo',
  campus_camera: '校园样例视频',
  ai_dataset_demo: 'AI 公开数据集验证',
  beijing_open_data_demo: '北京开放数据样例',
  beijing_realtime_parking: '北京实时泊位样例',
  beijing_roadside_parking_basic: '北京路侧/设施样例',
  osm_overpass_parking: 'OSM 候选',
  demo: '演示数据'
};

const sourceWeights = {
  campus_demo: 12,
  campus_camera: 12,
  ai_dataset_demo: -50,
  beijing_open_data_demo: 8,
  beijing_realtime_parking: 8,
  beijing_roadside_parking_basic: 7,
  osm_overpass_parking: 3,
  demo: -30
};

const sourceStyles = {
  campus_demo: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  campus_camera: 'border-teal-200 bg-teal-50 text-teal-800',
  ai_dataset_demo: 'border-sky-200 bg-sky-50 text-sky-800',
  beijing_open_data_demo: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  beijing_realtime_parking: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  beijing_roadside_parking_basic: 'border-blue-200 bg-blue-50 text-blue-800',
  osm_overpass_parking: 'border-zinc-200 bg-zinc-50 text-zinc-700',
  demo: 'border-zinc-200 bg-zinc-50 text-zinc-700'
};

const sortOptions = [
  {
    value: 'recommended',
    label: '推荐',
    description: '余位、距离、分流',
    icon: Sparkles
  },
  {
    value: 'nearest',
    label: '最近',
    description: '靠近参考点',
    icon: MapPin
  },
  {
    value: 'available',
    label: '余位多',
    description: '剩余车位优先',
    icon: Navigation
  },
  {
    value: 'comfortable',
    label: '更宽松',
    description: '低占用优先',
    icon: Gauge
  }
];

const getMetadata = (lot) => lot?.slot_configuration?.metadata || {};

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const getStats = (lot) => {
  const stats = lot.statistics || {};
  const total = Number(stats.total_slots ?? lot.total_slots ?? 0);
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

const getDistanceKm = (from, to) => {
  if (!from || !to || to.latitude === null || to.longitude === null) {
    return null;
  }

  const earthRadiusKm = 6371;
  const toRadians = (degree) => (degree * Math.PI) / 180;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadiusKm * c * 10) / 10;
};

const formatDistance = (distanceKm) => {
  if (distanceKm === null) {
    return '待核验';
  }

  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`;
  }

  return `${distanceKm.toFixed(1)} km`;
};

const transformLat = (x, y) => {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return ret;
};

const transformLng = (x, y) => {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return ret;
};

const isOutsideChina = (latitude, longitude) => (
  longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271
);

const wgs84ToGcj02 = (latitude, longitude) => {
  if (latitude === null || longitude === null || isOutsideChina(latitude, longitude)) {
    return { latitude, longitude };
  }

  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  let dLat = transformLat(longitude - 105.0, latitude - 35.0);
  let dLng = transformLng(longitude - 105.0, latitude - 35.0);
  const radLat = (latitude / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);

  return {
    latitude: latitude + dLat,
    longitude: longitude + dLng
  };
};

const gcj02ToBd09 = (latitude, longitude) => {
  const xPi = (Math.PI * 3000.0) / 180.0;
  const z = Math.sqrt(longitude * longitude + latitude * latitude) + 0.00002 * Math.sin(latitude * xPi);
  const theta = Math.atan2(latitude, longitude) + 0.000003 * Math.cos(longitude * xPi);

  return {
    latitude: z * Math.sin(theta) + 0.006,
    longitude: z * Math.cos(theta) + 0.0065
  };
};

const hasNavigableCoordinates = (lot) => lot?.latitude !== null && lot?.longitude !== null;

const getExternalNavigationLinks = (lot) => {
  if (!hasNavigableCoordinates(lot)) {
    return [];
  }

  const name = encodeURIComponent(lot.name || 'ParkGov AI 停车场');
  const gcj = wgs84ToGcj02(lot.latitude, lot.longitude);
  const bd = gcj02ToBd09(gcj.latitude, gcj.longitude);
  const amapTo = `${gcj.longitude.toFixed(6)},${gcj.latitude.toFixed(6)},${name}`;

  return [
    {
      id: 'amap',
      label: '高德导航',
      primary: true,
      href: `https://uri.amap.com/navigation?to=${amapTo}&mode=car&coordinate=gaode&callnative=1`
    },
    {
      id: 'baidu',
      label: '百度地图',
      href: `https://api.map.baidu.com/marker?location=${bd.latitude.toFixed(6)},${bd.longitude.toFixed(6)}&title=${name}&content=${name}&output=html&src=parkgov-ai`
    },
    {
      id: 'tencent',
      label: '腾讯地图',
      href: `https://apis.map.qq.com/uri/v1/routeplan?type=drive&to=${name}&tocoord=${gcj.latitude.toFixed(6)},${gcj.longitude.toFixed(6)}&referer=ParkGovAI`
    }
  ];
};

const openNavigation = (lot, provider = 'amap') => {
  const links = getExternalNavigationLinks(lot);
  const link = links.find((item) => item.id === provider) || links[0];

  if (!link) {
    return false;
  }

  window.open(link.href, '_blank', 'noopener,noreferrer');
  return true;
};

const getCrowdStatus = (occupancy) => {
  if (occupancy >= 90) {
    return {
      label: '近满位',
      tone: 'danger',
      className: 'border-red-200 bg-red-50 text-red-700',
      dotClassName: 'bg-red-500',
      barClassName: 'bg-red-500'
    };
  }
  if (occupancy >= 75) {
    return {
      label: '紧张',
      tone: 'warning',
      className: 'border-orange-200 bg-orange-50 text-orange-700',
      dotClassName: 'bg-orange-500',
      barClassName: 'bg-orange-500'
    };
  }
  if (occupancy >= 50) {
    return {
      label: '较忙',
      tone: 'moderate',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
      dotClassName: 'bg-amber-500',
      barClassName: 'bg-amber-500'
    };
  }
  return {
    label: '宽松',
    tone: 'good',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dotClassName: 'bg-emerald-600',
    barClassName: 'bg-emerald-600'
  };
};

const formatUpdatedAt = (lot) => {
  const metadata = getMetadata(lot);
  const timestamp = metadata.imported_at || lot.updated_at || lot.created_at;

  if (!timestamp) {
    return '暂无更新时间';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
};

const getRecommendationReason = (lot) => {
  if (!lot) {
    return '暂无推荐结果';
  }

  const breakdown = getRecommendationBreakdown(lot);
  const topFactors = breakdown
    .sort((first, second) => second.value - first.value)
    .slice(0, 3)
    .map((factor) => `${factor.label} ${factor.value}`);

  return topFactors.length > 0
    ? `${topFactors.join('、')}；${lot.metadata.fee_rule ? '收费规则已标注' : '收费待补充'}`
    : '按余位、距离、拥挤缓解和数据可信度推荐';
};

const getTrustScore = (sourceType) => {
  const trustScores = {
    campus_demo: 88,
    campus_camera: 86,
    beijing_open_data_demo: 78,
    beijing_realtime_parking: 78,
    beijing_roadside_parking_basic: 72,
    osm_overpass_parking: 56,
    ai_dataset_demo: 46,
    demo: 40
  };

  return trustScores[sourceType] ?? 42;
};

const getRecommendationBreakdown = (lot) => {
  if (!lot) {
    return [];
  }

  const availabilityScore = lot.stats.total > 0
    ? Math.round(Math.min(100, (lot.stats.available / lot.stats.total) * 100 + Math.min(lot.stats.available, 20)))
    : 0;
  const distanceScore = lot.distanceKm === null
    ? 35
    : Math.round(Math.max(0, 100 - Math.min(lot.distanceKm, 10) * 9));
  const diversionScore = Math.round(Math.max(0, 100 - lot.stats.occupancy));
  const trustScore = getTrustScore(lot.sourceType);

  return [
    {
      id: 'availability',
      label: '余位保障',
      value: availabilityScore,
      detail: `${lot.stats.available}/${lot.stats.total} 个车位可用`
    },
    {
      id: 'distance',
      label: '距离便利',
      value: distanceScore,
      detail: lot.distanceKm === null ? '坐标待核验' : `${formatDistance(lot.distanceKm)} 参考距离`
    },
    {
      id: 'diversion',
      label: '拥挤缓解',
      value: diversionScore,
      detail: `占用率 ${lot.stats.occupancy}%`
    },
    {
      id: 'trust',
      label: '数据可信',
      value: trustScore,
      detail: lot.sourceLabel
    }
  ];
};

const getArrivalEstimate = (lot) => {
  if (!lot || lot.distanceKm === null) {
    return {
      label: '待核验',
      detail: '缺少经纬度，暂不估算到达时间'
    };
  }

  const minutes = Math.max(2, Math.round((lot.distanceKm / 18) * 60 + 3));

  return {
    label: `约 ${minutes} 分钟`,
    detail: `${formatDistance(lot.distanceKm)} 参考距离，按城市慢速通行估算`
  };
};

const getServiceReadiness = (lot) => {
  if (!lot) {
    return {
      label: '暂无选择',
      detail: '请选择停车场',
      className: 'border-zinc-200 bg-zinc-50 text-zinc-600'
    };
  }

  if (lot.sourceType === 'ai_dataset_demo') {
    return {
      label: '仅供验证',
      detail: '公开数据集结果，仅用于验证 AI 识别链路，不建议作为真实出行目标',
      className: 'border-sky-200 bg-sky-50 text-sky-700'
    };
  }

  if (lot.stats.available <= 0) {
    return {
      label: '暂不前往',
      detail: '当前不建议前往',
      className: 'border-red-200 bg-red-50 text-red-700'
    };
  }

  if (lot.stats.occupancy >= 90) {
    return {
      label: '谨慎前往',
      detail: '接近满位，建议优先查看备选',
      className: 'border-red-200 bg-red-50 text-red-700'
    };
  }

  if (lot.latitude === null || lot.longitude === null) {
    return {
      label: '信息待核验',
      detail: '余位可展示，地图与导航需要补齐坐标',
      className: 'border-amber-200 bg-amber-50 text-amber-700'
    };
  }

  if (!lot.metadata.fee_rule) {
    return {
      label: '信息待核验',
      detail: '可前往，但收费规则仍需核验',
      className: 'border-amber-200 bg-amber-50 text-amber-700'
    };
  }

  return {
    label: '建议前往',
    detail: '坐标、余位、收费信息较完整',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700'
  };
};

const getDataConfidence = (lot) => {
  if (!lot) {
    return {
      label: '未知',
      score: 0,
      detail: '暂无数据'
    };
  }

  if (lot.sourceType === 'campus_demo' || lot.sourceType === 'campus_camera') {
    return {
      label: '试点可信',
      score: getTrustScore(lot.sourceType),
      detail: '校园试点字段完整，适合演示闭环'
    };
  }

  if (lot.sourceType === 'beijing_open_data_demo' || lot.sourceType === 'beijing_realtime_parking') {
    return {
      label: '开放样例',
      score: getTrustScore(lot.sourceType),
      detail: '字段适配北京开放数据，正式接入前需更新授权数据'
    };
  }

  if (lot.sourceType === 'ai_dataset_demo') {
    return {
      label: 'AI 验证',
      score: getTrustScore(lot.sourceType),
      detail: '用于模型识别率验证，不等同真实停车服务'
    };
  }

  if (lot.sourceType === 'osm_overpass_parking') {
    return {
      label: '候选资源',
      score: getTrustScore(lot.sourceType),
      detail: 'OSM 候选点需人工核验与署名'
    };
  }

  return {
    label: '演示数据',
    score: getTrustScore(lot.sourceType),
    detail: '用于原型演示，正式使用前需替换'
  };
};

const getSourceBoundary = (lot) => {
  if (!lot) {
    return '暂无数据来源说明';
  }

  const sourceNotes = {
    campus_demo: '校园试点 demo 数据，用于北京高校停车治理原型演示，后续可替换为授权采集的校园停车场数据。',
    campus_camera: '校园样例视频识别结果，用于验证图片/视频到余位服务的链路，不代表实时摄像头接入。',
    ai_dataset_demo: 'AI 公开数据集验证结果，用于检验车位识别与写回能力，不代表真实停车场实时余位。',
    beijing_open_data_demo: '北京开放数据离线样例或字段模板，正式接入前需要使用官方 API key 或授权数据文件更新。',
    beijing_realtime_parking: '北京实时泊位样例字段，当前用于接口适配演示，不能等同于全市实时接入。',
    beijing_roadside_parking_basic: '北京路侧/设施样例字段，适合做地图信息层，仍需核验数据时间与许可。',
    osm_overpass_parking: 'OSM/Overpass 候选资源，仅用于停车资源初筛，正式使用前需要人工核验与 ODbL 署名。',
    demo: '演示数据，用于产品原型和流程验证。'
  };

  const externalId = lot.metadata.source_external_id;
  return `${sourceNotes[lot.sourceType] || sourceNotes.demo}${externalId ? ` 来源编号：${externalId}` : ''}`;
};

const enrichLot = (lot) => {
  const metadata = getMetadata(lot);
  const stats = getStats(lot);
  const latitude = toNumber(metadata.latitude);
  const longitude = toNumber(metadata.longitude);
  const distanceKm = getDistanceKm(referenceLocation, { latitude, longitude });
  const sourceType = metadata.source_type || 'demo';
  const distancePenalty = distanceKm === null ? 60 : Math.min(distanceKm, 12) * 4;
  const feeBonus = metadata.fee_rule ? 8 : 0;
  const availableRatio = stats.total > 0 ? stats.available / stats.total : 0;
  const recommendationScore =
    stats.available * 4 +
    availableRatio * 40 +
    (100 - stats.occupancy) * 0.7 +
    feeBonus +
    (sourceWeights[sourceType] || 0) -
    distancePenalty;

  return {
    ...lot,
    metadata,
    stats,
    latitude,
    longitude,
    distanceKm,
    sourceType,
    sourceLabel: sourceLabels[sourceType] || sourceType,
    recommendationScore: Math.round(recommendationScore * 10) / 10
  };
};

const SourceBadge = ({ lot, compact = false }) => (
  <span className={`inline-flex items-center rounded-md border ${compact ? 'px-2 py-0.5' : 'px-2.5 py-1'} text-xs font-medium ${sourceStyles[lot.sourceType] || sourceStyles.demo}`}>
    <Database className="mr-1 h-3.5 w-3.5" />
    {lot.sourceLabel}
  </span>
);

const OccupancyMeter = ({ lot, compact = false }) => {
  const crowdStatus = getCrowdStatus(lot.stats.occupancy);
  const width = Math.max(2, Math.min(100, lot.stats.occupancy));

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold ${crowdStatus.className}`}>
          <span className={`mr-1.5 h-2 w-2 rounded-full ${crowdStatus.dotClassName}`} />
          {crowdStatus.label}
        </span>
        <span className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-zinc-700`}>{lot.stats.occupancy}%</span>
      </div>
      <div className={`${compact ? 'mt-1.5 h-1' : 'mt-2 h-1.5'} overflow-hidden rounded-full bg-zinc-200`}>
        <div className={`h-full rounded-full ${crowdStatus.barClassName}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
};

const ServiceMetric = ({ label, value, subtext, icon: Icon, tone = 'default', dark = false }) => {
  const toneClassName = {
    default: dark ? 'text-white' : 'text-zinc-950',
    success: dark ? 'text-emerald-400' : 'text-emerald-700',
    warning: dark ? 'text-amber-300' : 'text-amber-700',
    info: dark ? 'text-sky-300' : 'text-sky-700'
  }[tone];
  const borderClassName = dark ? 'border-zinc-800' : 'border-zinc-200';
  const labelClassName = dark ? 'text-zinc-400' : 'text-zinc-500';
  const subtextClassName = dark ? 'text-zinc-500' : 'text-zinc-500';

  return (
    <div className={`min-w-0 border-l pl-3 first:border-l-0 first:pl-0 sm:pl-4 ${borderClassName}`}>
      <div className={`flex items-center gap-1.5 text-xs font-medium ${labelClassName}`}>
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <p className={`mt-1 text-2xl font-semibold leading-none ${toneClassName}`}>{value}</p>
      {subtext && <p className={`mt-1 truncate text-xs ${subtextClassName}`}>{subtext}</p>}
    </div>
  );
};

const QuickPick = ({ label, lot, icon: Icon, onSelectLot }) => {
  if (!lot) {
    return null;
  }

  const readiness = getServiceReadiness(lot);
  const confidence = getDataConfidence(lot);

  return (
    <article
      className="group flex min-h-[148px] flex-col justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
            <Icon className="h-4 w-4 text-zinc-400" />
            {label}
          </div>
          <p className="mt-2 line-clamp-1 text-sm font-semibold text-zinc-950">{lot.name}</p>
        </div>
        <span className={`flex-none rounded-md border px-2 py-0.5 text-xs font-semibold ${readiness.className}`}>
          {readiness.label}
        </span>
      </div>
      <div className="mt-3 grid w-full grid-cols-3 gap-2">
        <div>
          <p className="text-lg font-semibold leading-none text-emerald-700">{lot.stats.available}</p>
          <p className="mt-1 text-[11px] text-zinc-500">余位</p>
        </div>
        <div>
          <p className="text-lg font-semibold leading-none text-zinc-950">{formatDistance(lot.distanceKm)}</p>
          <p className="mt-1 text-[11px] text-zinc-500">距离</p>
        </div>
        <div>
          <p className="text-lg font-semibold leading-none text-zinc-950">{confidence.score}</p>
          <p className="mt-1 text-[11px] text-zinc-500">可信</p>
        </div>
      </div>
      <div className="mt-3 flex w-full items-center justify-between gap-2 text-xs text-zinc-500">
        <span className="truncate">{lot.metadata.fee_rule || '收费待补充'}</span>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          onClick={() => onSelectLot(lot)}
          className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-50"
        >
          看详情
          <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </button>
        <NavigationButton lot={lot} label="去导航" className="h-9 px-3 text-xs" />
      </div>
    </article>
  );
};

const ServiceBadge = ({ lot }) => {
  const readiness = getServiceReadiness(lot);

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${readiness.className}`}>
      {readiness.label}
    </span>
  );
};

const NavigationLinks = ({ lot, compact = false, className = '' }) => {
  const links = getExternalNavigationLinks(lot);

  if (links.length === 0) {
    return (
      <div className={`rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 ${className}`}>
        <span className="font-semibold">坐标待核验：</span>
        该停车场暂不能生成外部地图导航。
      </div>
    );
  }

  const primaryLink = links.find((link) => link.primary) || links[0];
  const secondaryLinks = links.filter((link) => link.id !== primaryLink.id);

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
      <a
        href={primaryLink.href}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center justify-center rounded-md bg-emerald-600 font-semibold text-white transition hover:bg-emerald-700 ${
          compact ? 'h-9 px-3 text-xs' : 'h-11 px-4 text-sm'
        }`}
      >
        <Navigation className="mr-1.5 h-4 w-4" />
        去导航
        <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
      </a>
      {secondaryLinks.map((link) => (
        <a
          key={link.id}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white font-semibold text-zinc-700 transition hover:bg-zinc-50 ${
            compact ? 'h-9 px-3 text-xs' : 'h-11 px-3 text-sm'
          }`}
        >
          {link.label}
        </a>
      ))}
      </div>
      <p className="mt-2 text-[11px] leading-5 text-zinc-500">
        将跳转外部地图；ParkGov AI 不请求定位、不做预约或支付。
      </p>
    </div>
  );
};

const NavigationButton = ({ lot, label = '导航', className = '' }) => {
  const canNavigate = hasNavigableCoordinates(lot);

  return (
    <button
      type="button"
      disabled={!canNavigate}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openNavigation(lot);
      }}
      className={`inline-flex min-w-0 items-center justify-center rounded-md font-semibold transition ${
        canNavigate
          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
          : 'cursor-not-allowed border border-amber-200 bg-amber-50 text-amber-700'
      } ${className}`}
    >
      <Navigation className="mr-1.5 h-4 w-4 flex-none" />
      <span className="truncate">{canNavigate ? label : '坐标待核验'}</span>
    </button>
  );
};

const ReadinessTile = ({ icon: Icon, label, value, detail, tone = 'default' }) => {
  const toneClassName = {
    default: 'text-zinc-950',
    success: 'text-emerald-700',
    warning: 'text-amber-700',
    info: 'text-sky-700'
  }[tone];

  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className={`mt-2 truncate text-base font-semibold ${toneClassName}`}>{value}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{detail}</p>
    </div>
  );
};

const RecommendationBreakdown = ({ lot, compact = false }) => {
  if (!lot) {
    return null;
  }

  return (
    <div className={compact ? 'space-y-3' : 'grid gap-3 sm:grid-cols-2'}>
      {getRecommendationBreakdown(lot).map((factor) => (
        <div key={factor.id} className="min-w-0">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-zinc-700">{factor.label}</span>
            <span className="font-semibold text-zinc-950">{factor.value}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-emerald-600"
              style={{ width: `${Math.max(4, Math.min(100, factor.value))}%` }}
            />
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{factor.detail}</p>
        </div>
      ))}
    </div>
  );
};

const PositioningStrip = () => (
  <section className="grid gap-3 md:grid-cols-3">
    {[
      {
        title: '可停优先',
        body: '优先推荐仍有稳定余位的停车场，减少到场后继续绕行。',
        icon: ShieldCheck
      },
      {
        title: '压力分流',
        body: '最近点偏满时，引导到距离可接受、占用更低的备选场站。',
        icon: Gauge
      },
      {
        title: '决策透明',
        body: '每个推荐都展示余位、距离、收费和数据来源，不把 demo 当真实部署。',
        icon: Database
      }
    ].map((item) => {
      const Icon = item.icon;
      return (
      <article key={item.title} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-emerald-700" />
          <p className="text-sm font-semibold text-zinc-950">{item.title}</p>
        </div>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{item.body}</p>
      </article>
      );
    })}
  </section>
);

const PressureDiversionPanel = ({ nearestLot, recommendedLot, comfortableLot }) => {
  if (!recommendedLot) {
    return null;
  }

  const nearestIsRecommended = nearestLot && String(nearestLot.id) === String(recommendedLot.id);
  const fallbackLot = comfortableLot && String(comfortableLot.id) !== String(recommendedLot.id)
    ? comfortableLot
    : nearestLot;
  const comparisonLot = nearestIsRecommended ? fallbackLot : nearestLot;
  const pressureGap = comparisonLot
    ? Math.round((comparisonLot.stats.occupancy - recommendedLot.stats.occupancy) * 10) / 10
    : 0;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-emerald-700">分流逻辑</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-950">压力分流模拟</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            当最近停车场偏满时，推荐会转向余位更稳、拥挤度更低的备选，避免把车辆继续导向压力点。
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs font-semibold text-zinc-500">单纯最近策略</p>
          <p className="mt-2 truncate text-sm font-semibold text-zinc-950">{nearestLot?.name || '暂无最近点位'}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {nearestLot ? `${formatDistance(nearestLot.distanceKm)} · 占用 ${nearestLot.stats.occupancy}% · 余位 ${nearestLot.stats.available}` : '坐标不足，无法估算'}
          </p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-700">ParkGov 分流推荐</p>
          <p className="mt-2 truncate text-sm font-semibold text-emerald-950">{recommendedLot.name}</p>
          <p className="mt-1 text-xs text-emerald-800">
            {formatDistance(recommendedLot.distanceKm)} · 占用 {recommendedLot.stats.occupancy}% · 余位 {recommendedLot.stats.available}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs leading-5 text-zinc-500">
        {comparisonLot && !nearestIsRecommended && pressureGap > 0
          ? `与最近点相比，当前推荐占用率低约 ${pressureGap} 个百分点，更适合作为分流目标。`
          : '如果最近点本身余位充足且压力可控，系统会保留最近方案；否则优先提示更稳妥备选。'}
      </p>
    </section>
  );
};

const TripReadinessPanel = ({ lot, recommendedLot, onOpenDetails }) => {
  if (!lot) {
    return null;
  }

  const arrival = getArrivalEstimate(lot);
  const readiness = getServiceReadiness(lot);
  const confidence = getDataConfidence(lot);
  const isRecommended = String(lot.id) === String(recommendedLot?.id);
  const readinessTone = readiness.label === '建议前往'
    ? 'success'
    : readiness.label === '仅供验证' || readiness.label === '信息待核验'
      ? 'warning'
      : 'default';

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold tracking-[0.16em] text-zinc-400">前往判断</p>
            <ServiceBadge lot={lot} />
          </div>
          <h2 className="mt-1 text-lg font-semibold text-zinc-950">是否适合前往</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            {isRecommended ? '当前推荐方案' : '当前选中方案'}：{getRecommendationReason(lot)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NavigationButton lot={lot} label="去导航" className="h-10 px-4 text-sm" />
          <button
            type="button"
            onClick={onOpenDetails}
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
          >
            决策面板
            <ArrowRight className="ml-2 h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <ReadinessTile icon={Clock3} label="到达预估" value={arrival.label} detail={arrival.detail} />
        <ReadinessTile icon={ShieldCheck} label="前往建议" value={readiness.label} detail={readiness.detail} tone={readinessTone} />
        <ReadinessTile icon={Database} label="数据可信度" value={confidence.label} detail={confidence.detail} tone="info" />
      </div>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-zinc-950">推荐分解释</p>
          <p className="text-xs text-zinc-500">余位保障、距离便利、拥挤缓解、数据可信</p>
        </div>
        <div className="mt-4">
          <RecommendationBreakdown lot={lot} />
        </div>
      </div>
    </section>
  );
};

const RecommendedPlan = ({ lot, onOpenDetails }) => {
  if (!lot) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <p className="text-sm font-semibold text-zinc-950">暂无可推荐停车场</p>
        <p className="mt-2 text-sm text-zinc-500">请调整搜索或来源筛选。</p>
      </div>
    );
  }

  const crowdStatus = getCrowdStatus(lot.stats.occupancy);

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="group block w-full rounded-xl border border-emerald-100 bg-white p-5 text-left shadow-sm transition hover:border-emerald-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-emerald-950 px-2.5 py-1 text-xs font-semibold text-white">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              分流推荐
            </span>
            <ServiceBadge lot={lot} />
          </div>
          <h2 className="mt-4 text-2xl font-semibold leading-tight text-zinc-950">{lot.name}</h2>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-600">
            {lot.metadata.district || '未知区域'} · {lot.metadata.address || '暂无地址'}
          </p>
        </div>
        <NavigationButton lot={lot} label="去导航" className="hidden h-10 px-3 text-xs sm:inline-flex" />
      </div>

      <div className="mt-5 grid grid-cols-3 divide-x divide-zinc-200 rounded-lg border border-zinc-200">
        <div className="px-3 py-3">
          <p className="text-2xl font-semibold leading-none text-emerald-700">{lot.stats.available}</p>
          <p className="mt-1 text-xs text-zinc-500">剩余车位</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-2xl font-semibold leading-none text-zinc-950">{formatDistance(lot.distanceKm)}</p>
          <p className="mt-1 text-xs text-zinc-500">参考距离</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-2xl font-semibold leading-none text-zinc-950">{lot.recommendationScore}</p>
          <p className="mt-1 text-xs text-zinc-500">推荐分</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SourceBadge lot={lot} />
        <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${crowdStatus.className}`}>
          <span className={`mr-1.5 h-2 w-2 rounded-full ${crowdStatus.dotClassName}`} />
          {crowdStatus.label}
        </span>
        <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600">
          <WalletCards className="mr-1 h-3.5 w-3.5" />
          {lot.metadata.fee_rule ? '收费已标注' : '收费待补充'}
        </span>
      </div>

      <div className="mt-4 rounded-lg bg-zinc-50 p-3">
        <p className="text-xs font-semibold text-zinc-500">为什么推荐</p>
        <p className="mt-1 text-sm leading-6 text-zinc-700">{getRecommendationReason(lot)}</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">推荐不是只按最近或最低价排序，而是优先保证可停并分散高占用压力。</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <button
            type="button"
            onClick={() => onOpenDetails(lot)}
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
          >
            查看停车决策
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </button>
          <NavigationButton lot={lot} label="高德导航" className="h-10 px-3 text-sm" />
        </div>
      </div>
    </motion.article>
  );
};

const ParkingMap = ({ lots, recommendedLotId, selectedLotId, selectedLot, onSelectLot }) => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const mapLots = lots.filter((lot) => lot.latitude !== null && lot.longitude !== null);
  const styleUrl = import.meta.env.VITE_MAP_STYLE_URL || defaultMapStyleUrl;

  useEffect(() => {
    if (!realMapEnabled || mapLots.length === 0 || !mapContainerRef.current || mapRef.current) {
      return undefined;
    }

    const centerLng = mapLots.reduce((sum, lot) => sum + lot.longitude, 0) / mapLots.length;
    const centerLat = mapLots.reduce((sum, lot) => sum + lot.latitude, 0) / mapLots.length;

    try {
      mapRef.current = new maplibregl.Map({
        container: mapContainerRef.current,
        style: styleUrl,
        center: [centerLng, centerLat],
        zoom: mapLots.length > 1 ? 12 : 15,
        attributionControl: true
      });

      mapRef.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      mapRef.current.on('load', () => setMapReady(true));
      mapRef.current.on('error', () => {
        setMapError('开放地图底图加载失败，已切换为轻量散点图。');
      });
    } catch (error) {
      setMapError(error.message || '地图初始化失败，已切换为轻量散点图。');
    }

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // Initialize once for this component; marker updates are handled separately.
  }, [styleUrl, mapLots.length]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) {
      return;
    }

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const bounds = new maplibregl.LngLatBounds();

    mapLots.forEach((lot) => {
      const isRecommended = String(lot.id) === String(recommendedLotId);
      const isSelected = String(lot.id) === String(selectedLotId);
      const isBusy = lot.stats.occupancy >= 75;
      const markerElement = document.createElement('button');
      markerElement.type = 'button';
      markerElement.className = [
        'h-5 w-5 rounded-full border-2 border-white shadow-lg transition',
        isSelected ? 'scale-125 ring-2 ring-zinc-950 ring-offset-2' : '',
        isRecommended ? 'bg-emerald-500' : isBusy ? 'bg-amber-500' : 'bg-teal-600'
      ].join(' ');
      markerElement.setAttribute('aria-label', `${lot.name}，剩余 ${lot.stats.available} 个车位`);
      markerElement.title = `${lot.name}，剩余 ${lot.stats.available} 个车位`;
      markerElement.addEventListener('click', () => onSelectLot?.(lot));

      const marker = new maplibregl.Marker({ element: markerElement, anchor: 'center' })
        .setLngLat([lot.longitude, lot.latitude])
        .addTo(mapRef.current);

      markersRef.current.push(marker);
      bounds.extend([lot.longitude, lot.latitude]);
    });

    if (mapLots.length === 1) {
      mapRef.current.flyTo({
        center: [mapLots[0].longitude, mapLots[0].latitude],
        zoom: 15,
        duration: 500
      });
    } else if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, {
        padding: 58,
        maxZoom: 15,
        duration: 500
      });
    }
  }, [mapReady, mapLots, onSelectLot, recommendedLotId, selectedLotId]);

  if (mapLots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100">
          <Layers className="h-6 w-6 text-zinc-400" />
        </div>
        <p className="mt-4 font-medium text-zinc-800">暂无可绘制经纬度</p>
        <p className="mx-auto mt-2 max-w-xs leading-6">
          坐标缺失不影响余位列表和详情服务；补齐经纬度后会自动进入地图。
        </p>
      </div>
    );
  }

  if (!realMapEnabled || mapError) {
    return (
      <FallbackParkingMap
        lots={lots}
        recommendedLotId={recommendedLotId}
        selectedLotId={selectedLotId}
        selectedLot={selectedLot}
        onSelectLot={onSelectLot}
        fallbackReason={mapError || '已关闭真实地图底图，使用轻量散点图展示停车资源。'}
      />
    );
  }

  const selectedMapLot = mapLots.find((lot) => String(lot.id) === String(selectedLotId)) || null;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-950">城市停车资源地图</p>
            <p className="mt-0.5 text-xs text-zinc-500">OpenFreeMap / OpenStreetMap 底图，固定参考点，不请求定位</p>
          </div>
          <span className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500">{mapLots.length} 个坐标点</span>
        </div>
      </div>

      <div className="relative h-72 w-full overflow-hidden bg-[#eef2ed]">
        <div ref={mapContainerRef} className="h-full w-full" aria-label="停车场交互地图" />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-zinc-500 backdrop-blur-sm">
            正在加载开放地图底图...
          </div>
        )}
      </div>

      <div className="border-t border-zinc-100 px-4 py-3">
        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-50 px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-full bg-teal-600" />
            可停
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-50 px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            紧张
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-50 px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            推荐
          </span>
        </div>
        {selectedLot && (
          <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <div className="flex min-w-0 items-start gap-2">
              <MapPin className="mt-0.5 h-3.5 w-3.5 flex-none text-zinc-400" />
              <p className="min-w-0 leading-5">
                <span className="font-semibold text-zinc-900">选中：</span>
                <span className="font-medium text-zinc-800">{selectedLot.name}</span>
                <span className="text-zinc-400"> · </span>
                剩余 {selectedLot.stats.available} 个
                <span className="text-zinc-400"> · </span>
                {selectedMapLot ? formatDistance(selectedMapLot.distanceKm) : '坐标待核验'}
              </p>
            </div>
            {selectedMapLot && (
              <NavigationButton lot={selectedMapLot} label="导航" className="h-8 flex-none px-2.5 text-xs" />
            )}
          </div>
        )}
        <p className="mt-3 text-[11px] leading-5 text-zinc-500">
          底图用于空间展示；停车余位来自 ParkGov AI demo、开放数据样例、OSM 候选和 AI 数据集验证。
        </p>
      </div>
    </div>
  );
};

const FallbackParkingMap = ({ lots, recommendedLotId, selectedLotId, selectedLot, onSelectLot, fallbackReason = '' }) => {
  const mapLots = lots.filter((lot) => lot.latitude !== null && lot.longitude !== null);

  const latitudes = mapLots.map((lot) => lot.latitude);
  const longitudes = mapLots.map((lot) => lot.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latSpan = maxLat - minLat || 0.01;
  const lngSpan = maxLng - minLng || 0.01;
  const selectedMapLot = mapLots.find((lot) => String(lot.id) === String(selectedLotId)) || null;
  const selectedHasCoordinates = Boolean(selectedMapLot);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-950">城市停车资源感知图</p>
            <p className="mt-0.5 text-xs text-zinc-500">点位散布用于演示资源分布，非商业地图底图</p>
          </div>
          <span className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500">{mapLots.length} 个坐标点</span>
        </div>
      </div>

      <svg viewBox="0 0 100 100" className="h-72 w-full bg-[#f6f7f4]" aria-label="停车场空间散点图">
        <defs>
          <pattern id="parking-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#e5e7df" strokeWidth="0.45" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill="url(#parking-grid)" />
        <path d="M6 72 C20 61, 34 75, 48 62 S77 50, 94 64" fill="none" stroke="#a7b5aa" strokeWidth="1.35" />
        <path d="M9 28 C27 37, 43 18, 60 29 S78 43, 93 31" fill="none" stroke="#cad5cc" strokeWidth="1.1" />
        <circle cx="50" cy="51" r="4" fill="#18181b" opacity="0.9" />
        <circle cx="50" cy="51" r="8" fill="none" stroke="#10b981" strokeWidth="0.75" opacity="0.45" />
        <text x="50" y="61" textAnchor="middle" fontSize="3" fill="#3f3f46">高校参考点</text>
        {mapLots.map((lot) => {
          const x = 11 + ((lot.longitude - minLng) / lngSpan) * 78;
          const y = 13 + (1 - (lot.latitude - minLat) / latSpan) * 74;
          const isRecommended = String(lot.id) === String(recommendedLotId);
          const isSelected = String(lot.id) === String(selectedLotId);
          const isBusy = lot.stats.occupancy >= 75;

          return (
            <g
              key={lot.id}
              role="button"
              tabIndex={0}
              className="cursor-pointer outline-none"
              onClick={() => onSelectLot?.(lot)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectLot?.(lot);
                }
              }}
            >
              <title>{lot.name}，剩余 {lot.stats.available} 个车位</title>
              {isRecommended && <circle cx={x} cy={y} r="9" fill="#ccfbf1" opacity="0.95" />}
              {isSelected && <circle cx={x} cy={y} r="10.5" fill="none" stroke="#18181b" strokeWidth="1.3" strokeDasharray="2 2" />}
              <circle
                cx={x}
                cy={y}
                r={isRecommended ? 5 : 3.8}
                fill={isBusy ? '#f59e0b' : '#059669'}
                stroke="#ffffff"
                strokeWidth="1.6"
              />
            </g>
          );
        })}
      </svg>

      <div className="border-t border-zinc-100 px-4 py-3">
        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-50 px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
            可停
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-50 px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            紧张
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-50 px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-full bg-teal-100 ring-1 ring-teal-300" />
            推荐
          </span>
        </div>
        {selectedLot && (
          <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <div className="flex min-w-0 items-start gap-2">
              <MapPin className="mt-0.5 h-3.5 w-3.5 flex-none text-zinc-400" />
              <p className="min-w-0 leading-5">
                <span className="font-semibold text-zinc-900">选中：</span>
                <span className="font-medium text-zinc-800">{selectedLot.name}</span>
                <span className="text-zinc-400"> · </span>
                剩余 {selectedLot.stats.available} 个
                <span className="text-zinc-400"> · </span>
                {selectedHasCoordinates ? formatDistance(selectedMapLot.distanceKm) : '坐标待核验'}
              </p>
            </div>
            {selectedHasCoordinates && (
              <NavigationButton lot={selectedMapLot} label="导航" className="h-8 flex-none px-2.5 text-xs" />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const SelectedLotPanel = ({
  lot,
  recommendedLot,
  className = '',
  showFullDetailsButton = false,
  onOpenDetails
}) => {
  const [activeAction, setActiveAction] = useState('route');

  if (!lot) {
    return null;
  }

  const crowdStatus = getCrowdStatus(lot.stats.occupancy);
  const isRecommended = String(lot.id) === String(recommendedLot?.id);
  const hasCoordinates = lot.latitude !== null && lot.longitude !== null;
  const arrival = getArrivalEstimate(lot);
  const readiness = getServiceReadiness(lot);
  const confidence = getDataConfidence(lot);
  const coordinateText = hasCoordinates
    ? `${lot.latitude.toFixed(5)}, ${lot.longitude.toFixed(5)}`
    : '待补充坐标';
  const actionDetails = {
    route: {
      title: '外部地图导航',
      description: hasCoordinates
        ? `从“${referenceLocation.name}”出发，估算距离 ${formatDistance(lot.distanceKm)}。将跳转到外部地图，不请求 ParkGov 页面内定位权限。`
        : '该停车场暂缺经纬度，先保留服务详情；补齐坐标后可生成外部地图导航。'
    },
    fee: {
      title: '收费规则',
      description: lot.metadata.fee_rule || '暂无收费规则。本页保守展示“暂无收费标准”，后续可通过校园管理规则或北京开放数据补齐。'
    },
    source: {
      title: '数据来源',
      description: getSourceBoundary(lot)
    }
  };
  const actions = [
    { id: 'route', label: '导航', icon: Navigation },
    { id: 'fee', label: '收费', icon: CircleDollarSign },
    { id: 'source', label: '来源', icon: Database }
  ];
  const activeDetail = actionDetails[activeAction];

  return (
    <div className={`rounded-xl border border-zinc-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-500">停车决策面板</p>
          <h2 className="mt-2 text-lg font-semibold leading-tight text-zinc-950">{lot.name}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            {lot.metadata.district || '未知区域'} · {lot.metadata.address || '暂无地址'}
          </p>
        </div>
        {isRecommended && (
          <span className="flex-none rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
            推荐
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-zinc-200 rounded-lg border border-zinc-200">
        <div className="px-3 py-3">
          <p className="text-2xl font-semibold leading-none text-emerald-700">{lot.stats.available}</p>
          <p className="mt-1 text-xs text-zinc-500">余位</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-xl font-semibold leading-none text-zinc-950">{formatDistance(lot.distanceKm)}</p>
          <p className="mt-1 text-xs text-zinc-500">距离</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-xl font-semibold leading-none text-zinc-950">{lot.stats.occupancy}%</p>
          <p className="mt-1 text-xs text-zinc-500">{crowdStatus.label}</p>
        </div>
      </div>

      <div className="mt-4">
        <OccupancyMeter lot={lot} />
      </div>

      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm leading-6 text-emerald-900">
        <span className="font-semibold">推荐依据：</span>
        {getRecommendationReason(lot)}
      </div>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-zinc-950">可解释推荐分</p>
          <p className="text-xs text-zinc-500">{lot.recommendationScore} 综合分</p>
        </div>
        <div className="mt-3">
          <RecommendationBreakdown lot={lot} compact />
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
          <p className="text-xs text-zinc-500">到达预估</p>
          <p className="mt-1 text-sm font-semibold text-zinc-950">{arrival.label}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
          <p className="text-xs text-zinc-500">服务状态</p>
          <p className="mt-1 text-sm font-semibold text-zinc-950">{readiness.label}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
          <p className="text-xs text-zinc-500">数据可信度</p>
          <p className="mt-1 text-sm font-semibold text-zinc-950">{confidence.label}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          const isActive = activeAction === action.id;
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => setActiveAction(action.id)}
              className={`min-h-11 rounded-md border px-2 text-xs font-semibold transition sm:text-sm ${
                isActive
                  ? 'border-zinc-950 bg-zinc-950 text-white'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <Icon className="h-4 w-4" />
                {action.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600">
        <p className="font-semibold text-zinc-950">{activeDetail.title}</p>
        <p className="mt-1">{activeDetail.description}</p>
        {activeAction === 'route' && (
          <NavigationLinks lot={lot} compact className="mt-3" />
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <SourceBadge lot={lot} />
        <span className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold ${crowdStatus.className}`}>
          {crowdStatus.label}
        </span>
      </div>

      {showFullDetailsButton && (
        <button
          type="button"
          onClick={onOpenDetails}
          className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          <PanelRightOpen className="mr-2 h-4 w-4" />
          打开完整决策面板
        </button>
      )}
    </div>
  );
};

const LotRow = ({ lot, index, recommendedLot, selectedLot, onSelectLot }) => {
  const isRecommended = recommendedLot?.id === lot.id;
  const isSelected = selectedLot?.id === lot.id;
  const crowdStatus = getCrowdStatus(lot.stats.occupancy);

  return (
    <motion.article
      role="button"
      tabIndex={0}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.025 }}
      onClick={() => onSelectLot?.(lot)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectLot?.(lot);
        }
      }}
      className={`group grid cursor-pointer gap-4 rounded-xl border px-4 py-4 outline-none transition hover:border-zinc-300 hover:bg-white hover:shadow-sm focus:border-zinc-400 lg:grid-cols-[minmax(0,1.45fr)_0.52fr_0.52fr_0.72fr_0.85fr] lg:items-center ${
        isSelected ? 'border-zinc-950 bg-white shadow-sm' : isRecommended ? 'border-sky-200 bg-sky-50/60' : 'border-zinc-200 bg-white'
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-base font-semibold text-zinc-950">{lot.name}</h2>
          {isRecommended && (
            <span className="inline-flex items-center rounded-md border border-sky-200 bg-white px-2 py-0.5 text-xs font-semibold text-sky-700">
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              推荐
            </span>
          )}
          {isSelected && (
            <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-semibold text-zinc-700">
              已选
            </span>
          )}
          <ServiceBadge lot={lot} />
        </div>
        <p className="mt-2 flex min-w-0 items-start text-sm text-zinc-600">
          <MapPin className="mr-1.5 mt-0.5 h-4 w-4 flex-none text-zinc-400" />
          <span className="truncate">
            {lot.metadata.district || '未知区域'} · {lot.metadata.address || '暂无地址'}
          </span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <SourceBadge lot={lot} compact />
          {lot.sourceType === 'ai_dataset_demo' && (
            <span className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-600">
              AI event 已写回
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 lg:contents">
        <div>
          <p className="text-xl font-semibold leading-none text-zinc-950">{formatDistance(lot.distanceKm)}</p>
          <p className="mt-1 text-xs text-zinc-500">距离</p>
        </div>

        <div>
          <p className="text-3xl font-semibold leading-none text-emerald-700 lg:text-2xl">{lot.stats.available}</p>
          <p className="mt-1 text-xs text-zinc-500">余位 / {lot.stats.total}</p>
        </div>

        <div className="lg:hidden">
          <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${crowdStatus.className}`}>
            {crowdStatus.label}
          </span>
          <p className="mt-1 text-xs text-zinc-500">{lot.stats.occupancy}%</p>
        </div>
      </div>

      <div className="hidden lg:block">
        <OccupancyMeter lot={lot} compact />
      </div>

      <div className="min-w-0 text-sm leading-5 text-zinc-700">
        <p className="line-clamp-2">{lot.metadata.fee_rule || '暂无收费标准'}</p>
      </div>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span className="inline-flex min-w-0 items-center">
          <Clock3 className="mr-1.5 h-4 w-4 flex-none" />
          <span className="truncate">{formatUpdatedAt(lot)}</span>
        </span>
        <NavigationButton lot={lot} label="导航" className="ml-2 hidden h-9 px-3 text-xs sm:inline-flex" />
      </div>
    </motion.article>
  );
};

const ParkingLotDetailDrawer = ({ lot, recommendedLot, isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!lot) {
    return null;
  }

  const crowdStatus = getCrowdStatus(lot.stats.occupancy);
  const isRecommended = String(lot.id) === String(recommendedLot?.id);
  const coordinateText = lot.latitude !== null && lot.longitude !== null
    ? `${lot.latitude.toFixed(5)}, ${lot.longitude.toFixed(5)}`
    : '待补充坐标';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.button
            type="button"
            aria-label="关闭停车场详情"
            className="absolute inset-0 bg-zinc-950/35"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={`${lot.name} 停车场详情`}
            className="absolute inset-x-0 bottom-0 flex max-h-[88svh] flex-col overflow-hidden rounded-t-2xl border-t border-zinc-200 bg-white shadow-2xl lg:inset-y-0 lg:left-auto lg:right-0 lg:h-full lg:max-h-none lg:w-[480px] lg:rounded-none lg:border-l lg:border-t-0"
            initial={{ x: 36, y: 36, opacity: 0 }}
            animate={{ x: 0, y: 0, opacity: 1 }}
            exit={{ x: 36, y: 36, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
          >
            <div className="border-b border-zinc-200 px-4 pb-4 pt-3 sm:px-5">
              <div className="mx-auto mb-3 h-1 w-11 rounded-full bg-zinc-300 lg:hidden" />
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold text-zinc-500">停车决策面板</p>
                    {isRecommended && (
                      <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
                        当前推荐
                      </span>
                    )}
                  </div>
                  <h2 className="mt-2 text-xl font-semibold leading-tight text-zinc-950">{lot.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    {lot.metadata.district || '未知区域'} · {lot.metadata.address || '暂无地址'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950"
                  aria-label="关闭详情"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className={`mt-4 rounded-lg border px-3 py-2 text-sm font-semibold ${getServiceReadiness(lot).className}`}>
                {getServiceReadiness(lot).label} · {getServiceReadiness(lot).detail}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
                  <p className="text-xl font-semibold leading-none">{lot.stats.available}</p>
                  <p className="mt-1 text-xs">剩余</p>
                </div>
                <div className="rounded-lg bg-zinc-50 px-3 py-2 text-zinc-800">
                  <p className="text-xl font-semibold leading-none">{formatDistance(lot.distanceKm)}</p>
                  <p className="mt-1 text-xs">距离</p>
                </div>
                <div className={`rounded-lg px-3 py-2 ${crowdStatus.className}`}>
                  <p className="text-sm font-semibold leading-none">{crowdStatus.label}</p>
                  <p className="mt-1 text-xs">{lot.stats.occupancy}% 占用</p>
                </div>
              </div>
              <NavigationLinks lot={lot} className="mt-4" />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <SelectedLotPanel
                lot={lot}
                recommendedLot={recommendedLot}
                className="border-0 p-0 shadow-none"
              />

              <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm font-semibold text-zinc-950">服务说明</p>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  当前推荐分为 {lot.recommendationScore}，按剩余车位、参考距离、占用率、收费信息完整度和来源可信度计算。
                </p>
              </div>

              <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
                <p className="text-sm font-semibold text-zinc-950">坐标与边界</p>
                <p className="mt-2 text-sm leading-6 text-zinc-600">坐标：{coordinateText}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{getSourceBoundary(lot)}</p>
              </div>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const MobileParkingActionBar = ({ lot, onOpenDetails }) => {
  if (!lot) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
      <div className="mx-auto max-w-[1500px]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-zinc-950">{lot.name}</p>
            <ServiceBadge lot={lot} />
          </div>
          <p className="mt-1 truncate text-xs text-zinc-500">
            {lot.stats.available} 个余位 · {formatDistance(lot.distanceKm)} · {lot.metadata.fee_rule || '收费待补充'}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <NavigationButton lot={lot} label="去导航" className="h-11 px-4 text-sm" />
          <button
            type="button"
            onClick={onOpenDetails}
            className="inline-flex h-11 flex-none items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800"
          >
            详情
          </button>
          <a
            href="#parking-lot-list"
            className="inline-flex h-11 flex-none items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800"
          >
            换一个
          </a>
        </div>
      </div>
    </div>
  );
};

const ParkGovAgentLauncher = ({ onOpen, hasSelectedLot }) => (
  <button
    type="button"
    onClick={onOpen}
    className="fixed bottom-36 right-4 z-30 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-zinc-950 px-4 py-3 text-sm font-semibold text-white shadow-xl transition hover:-translate-y-0.5 hover:bg-zinc-800 lg:bottom-6 lg:right-6"
  >
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400 text-zinc-950">
      <Bot className="h-4 w-4" />
    </span>
    <span className="hidden sm:inline">ParkGov Agent</span>
    <span className="sr-only">{hasSelectedLot ? '打开当前停车场智能助手' : '打开 ParkGov 智能体助手'}</span>
  </button>
);

const ServiceUnavailableState = ({ error, onRetry, refreshing }) => (
  <main className="mx-auto max-w-[1500px] px-4 pb-24 pt-6 sm:px-6 lg:px-8">
    <section className="grid min-h-[calc(100svh-140px)] items-center gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Backend Required</p>
        <h1 className="mt-2 text-2xl font-semibold leading-tight text-zinc-950 sm:text-3xl">
          后端服务未连接，暂不能展示实时余位
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-600">
          ParkGov AI 线上展示必须连接 Render 后端和 Neon PostgreSQL。当前不会使用静态假数据冒充余位，请检查 `VITE_API_URL`、Render 服务健康状态和数据库连接。
        </p>
        <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
          <p className="font-semibold text-zinc-950">错误信息</p>
          <p className="mt-1 break-words">{error || '停车场数据加载失败'}</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRetry}
            disabled={refreshing}
            className="inline-flex h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            重新连接
          </button>
          <Link
            to="/login"
            className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
          >
            检查管理端
          </Link>
        </div>
      </div>

      <aside className="rounded-2xl border border-zinc-200 bg-zinc-950 p-5 text-white shadow-sm">
        <BrandMark inverted showBadge subtitle="真实后端展示模式" />
        <div className="mt-6 space-y-3 text-sm text-zinc-300">
          <p className="rounded-lg border border-white/10 bg-white/10 p-3">
            Netlify 前端需要设置 `VITE_API_URL=https://你的后端域名/api`。
          </p>
          <p className="rounded-lg border border-white/10 bg-white/10 p-3">
            Render 后端需要设置 `DATABASE_URL`、`DATABASE_SSL=true`、`FRONTEND_URLS` 和 `JWT_SECRET`。
          </p>
          <p className="rounded-lg border border-white/10 bg-white/10 p-3">
            Neon 数据库初始化后再运行 `seed:mvp` 和 `demo:ai-run`，用户端才会显示真实数据库余位。
          </p>
        </div>
      </aside>
    </section>
  </main>
);

const ParkingLotsPage = () => {
  const [parkingLots, setParkingLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortMode, setSortMode] = useState('recommended');
  const [selectedLotId, setSelectedLotId] = useState('');
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isAgentOpen, setIsAgentOpen] = useState(false);

  const loadParkingLots = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const response = await parkingService.getAllParkingLots();
      const lots = response.data?.data?.parking_lots || [];
      setParkingLots(lots);
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || '停车场数据加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadParkingLots();
  }, []);

  const enrichedLots = useMemo(() => parkingLots.map(enrichLot), [parkingLots]);

  const sourceOptions = useMemo(() => {
    const currentSourceTypes = Array.from(new Set(enrichedLots.map((lot) => lot.sourceType)));
    return currentSourceTypes.map((sourceType) => ({
      value: sourceType,
      label: sourceLabels[sourceType] || sourceType
    }));
  }, [enrichedLots]);

  const summary = useMemo(() => {
    return enrichedLots.reduce(
      (accumulator, lot) => {
        accumulator.totalLots += 1;
        accumulator.totalSpaces += lot.stats.total;
        accumulator.availableSpaces += lot.stats.available;
        accumulator.occupiedSpaces += lot.stats.occupied;
        if (lot.distanceKm !== null) {
          accumulator.distanceKnown += 1;
        }
        if (lot.stats.occupancy >= 75) {
          accumulator.busyLots += 1;
        }
        return accumulator;
      },
      {
        totalLots: 0,
        totalSpaces: 0,
        availableSpaces: 0,
        occupiedSpaces: 0,
        distanceKnown: 0,
        busyLots: 0
      }
    );
  }, [enrichedLots]);

  const filteredLots = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return enrichedLots
      .filter((lot) => {
        const matchesSource = sourceFilter === 'all' || lot.sourceType === sourceFilter;
        const haystack = [
          lot.name,
          lot.metadata.district,
          lot.metadata.address,
          lot.metadata.fee_rule,
          lot.sourceLabel
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return matchesSource && (!normalizedQuery || haystack.includes(normalizedQuery));
      })
      .sort((first, second) => {
        const firstDistance = first.distanceKm ?? 9999;
        const secondDistance = second.distanceKm ?? 9999;
        if (sortMode === 'nearest') {
          return firstDistance - secondDistance || second.recommendationScore - first.recommendationScore;
        }
        if (sortMode === 'available') {
          return second.stats.available - first.stats.available || firstDistance - secondDistance;
        }
        if (sortMode === 'comfortable') {
          return first.stats.occupancy - second.stats.occupancy || firstDistance - secondDistance;
        }
        return second.recommendationScore - first.recommendationScore || firstDistance - secondDistance;
      });
  }, [enrichedLots, query, sourceFilter, sortMode]);

  const recommendedLot = filteredLots[0] || null;
  const selectedLot = filteredLots.find((lot) => String(lot.id) === String(selectedLotId)) || recommendedLot;
  const nearestLot = useMemo(() => (
    filteredLots.filter((lot) => lot.distanceKm !== null).sort((first, second) => first.distanceKm - second.distanceKm)[0] || null
  ), [filteredLots]);
  const mostAvailableLot = useMemo(() => (
    [...filteredLots].sort((first, second) => second.stats.available - first.stats.available)[0] || null
  ), [filteredLots]);
  const comfortableLot = useMemo(() => (
    [...filteredLots].sort((first, second) => first.stats.occupancy - second.stats.occupancy)[0] || null
  ), [filteredLots]);
  const averageOccupancy = summary.totalSpaces > 0
    ? Math.round((summary.occupiedSpaces / summary.totalSpaces) * 100)
    : 0;
  const agentContext = useMemo(() => ({
    page: 'parking-lots',
    summary: {
      totalLots: summary.totalLots,
      totalSpaces: summary.totalSpaces,
      availableSpaces: summary.availableSpaces,
      averageOccupancy,
      busyLots: summary.busyLots
    },
    recommendedLot: recommendedLot ? {
      name: recommendedLot.name,
      available: recommendedLot.stats.available,
      total: recommendedLot.stats.total,
      occupancy: recommendedLot.stats.occupancy,
      distance: formatDistance(recommendedLot.distanceKm),
      sourceType: recommendedLot.sourceType,
      sourceLabel: recommendedLot.sourceLabel,
      feeRule: recommendedLot.metadata.fee_rule || '暂无收费标准',
      reason: getRecommendationReason(recommendedLot),
      breakdown: getRecommendationBreakdown(recommendedLot),
      navigationAvailable: hasNavigableCoordinates(recommendedLot)
    } : null,
    selectedLot: selectedLot ? {
      name: selectedLot.name,
      available: selectedLot.stats.available,
      total: selectedLot.stats.total,
      occupancy: selectedLot.stats.occupancy,
      distance: formatDistance(selectedLot.distanceKm),
      sourceType: selectedLot.sourceType,
      sourceLabel: selectedLot.sourceLabel,
      feeRule: selectedLot.metadata.fee_rule || '暂无收费标准',
      address: selectedLot.metadata.address || '暂无地址',
      reason: getRecommendationReason(selectedLot),
      breakdown: getRecommendationBreakdown(selectedLot),
      navigationAvailable: hasNavigableCoordinates(selectedLot)
    } : null,
    nearestLot: nearestLot ? {
      name: nearestLot.name,
      available: nearestLot.stats.available,
      total: nearestLot.stats.total,
      occupancy: nearestLot.stats.occupancy,
      distance: formatDistance(nearestLot.distanceKm)
    } : null
  }), [averageOccupancy, nearestLot, recommendedLot, selectedLot, summary]);

  useEffect(() => {
    if (filteredLots.length === 0) {
      if (selectedLotId) {
        setSelectedLotId('');
      }
      return;
    }

    const selectedStillVisible = filteredLots.some((lot) => String(lot.id) === String(selectedLotId));
    if (!selectedStillVisible) {
      setSelectedLotId(String(filteredLots[0].id));
    }
  }, [filteredLots, selectedLotId]);

  useEffect(() => {
    if (filteredLots[0] && String(filteredLots[0].id) !== String(selectedLotId)) {
      setSelectedLotId(String(filteredLots[0].id));
    }
    // Deliberately follows user service controls so the selected detail matches the current recommendation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sourceFilter, sortMode]);

  useEffect(() => {
    if (!selectedLot && isDetailOpen) {
      setIsDetailOpen(false);
    }
  }, [selectedLot, isDetailOpen]);

  const openLotDetails = (lot) => {
    if (!lot) {
      return;
    }
    setSelectedLotId(String(lot.id));
    setIsDetailOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#f4f6f3] text-zinc-950">
      <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/parking-lots" className="flex min-w-0 items-center gap-3">
            <BrandMark size="sm" subtitle="北京高校停车治理试点平台" showBadge />
          </Link>
          <nav className="hidden items-center rounded-lg border border-zinc-200 bg-zinc-50 p-1 text-sm text-zinc-600 md:flex">
            <span className="rounded-md bg-white px-3 py-1.5 font-semibold text-zinc-950 shadow-sm">停车服务</span>
            <Link to="/admin/status" className="rounded-md px-3 py-1.5 transition hover:text-zinc-950">管理端</Link>
            <Link to="/admin/governance" className="rounded-md px-3 py-1.5 transition hover:text-zinc-950">治理端</Link>
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadParkingLots(true)}
              disabled={refreshing}
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
            <Link
              to="/login"
              className="hidden h-10 items-center justify-center rounded-md bg-zinc-950 px-3 text-sm font-medium text-white transition hover:bg-zinc-800 sm:inline-flex"
            >
              <LogIn className="mr-2 h-4 w-4" />
              登录
            </Link>
          </div>
        </div>
      </header>

      {error && !loading ? (
        <ServiceUnavailableState error={error} refreshing={refreshing} onRetry={() => loadParkingLots(true)} />
      ) : (
      <main className="mx-auto max-w-[1500px] px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-8">
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_410px]">
          <div className="min-w-0 space-y-5">
            <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_390px]">
              <div className="relative overflow-hidden rounded-2xl bg-zinc-950 p-5 text-white shadow-sm sm:p-6">
                <div className="pointer-events-none absolute inset-0 opacity-45">
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage:
                        'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
                      backgroundSize: '34px 34px'
                    }}
                  />
                  <div className="absolute right-8 top-8 h-44 w-44 rounded-full border border-emerald-300/20" />
                  <div className="absolute bottom-6 right-20 grid grid-cols-4 gap-2">
                    {Array.from({ length: 16 }).map((_, index) => (
                      <span
                        key={index}
                        className={`h-8 w-4 rounded-[3px] border ${index % 5 === 0 ? 'border-amber-300/45 bg-amber-300/15' : 'border-emerald-300/35 bg-emerald-300/10'}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-300">
                    <LocateFixed className="h-4 w-4 text-emerald-300" />
                    <span>{referenceLocation.name}</span>
                    <span className="h-1 w-1 rounded-full bg-zinc-600" />
                    <span>固定参考点，不请求定位</span>
                  </div>
                  <CapabilityStrip inverted className="mt-5" />
                  <h1 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl">
                    现在去哪儿停？
                  </h1>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-300">
                    先判断哪里更稳妥，再解释为什么推荐。余位、距离、拥挤度和数据可信度一起参与决策。
                  </p>

                  <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
                    <ServiceMetric dark label="当前余位" value={summary.availableSpaces} subtext={`${summary.totalSpaces} 总车位`} icon={Navigation} tone="success" />
                    <ServiceMetric dark label="可选停车场" value={summary.totalLots} subtext={`${summary.distanceKnown} 个有坐标`} icon={Layers} />
                    <ServiceMetric dark label="平均占用" value={`${averageOccupancy}%`} subtext={`${summary.busyLots} 个偏紧张`} icon={Gauge} tone={averageOccupancy >= 75 ? 'warning' : 'default'} />
                  </div>
                </div>
              </div>

              <RecommendedPlan lot={recommendedLot} onOpenDetails={openLotDetails} />
            </section>

            <PositioningStrip />

            <section className="grid gap-3 md:grid-cols-3">
              <QuickPick label="最快可达" lot={nearestLot} icon={Navigation} onSelectLot={openLotDetails} />
              <QuickPick label="余位更稳" lot={mostAvailableLot} icon={ShieldCheck} onSelectLot={openLotDetails} />
              <QuickPick label="分流推荐" lot={comfortableLot} icon={Gauge} onSelectLot={openLotDetails} />
            </section>

            <TripReadinessPanel
              lot={selectedLot}
              recommendedLot={recommendedLot}
              onOpenDetails={() => setIsDetailOpen(true)}
            />

            <PressureDiversionPanel
              nearestLot={nearestLot}
              recommendedLot={recommendedLot}
              comfortableLot={comfortableLot}
            />

            <section className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_230px]">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索停车场、区域、地址或收费规则"
                    className="h-11 w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                  />
                </label>
                <label className="relative block">
                  <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <select
                    value={sourceFilter}
                    onChange={(event) => setSourceFilter(event.target.value)}
                    className="h-11 w-full appearance-none rounded-lg border border-zinc-300 bg-white pl-9 pr-8 text-sm text-zinc-800 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                  >
                    <option value="all">全部来源</option>
                    {sourceOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {sortOptions.map((option) => {
                  const Icon = option.icon;
                  const isActive = sortMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setSortMode(option.value)}
                      className={`flex min-h-[52px] items-center gap-3 rounded-lg border px-3 text-left transition ${
                        isActive
                          ? 'border-zinc-950 bg-zinc-950 text-white'
                          : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
                      }`}
                    >
                      <Icon className="h-4 w-4 flex-none" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className={`mt-0.5 block truncate text-xs ${isActive ? 'text-zinc-300' : 'text-zinc-500'}`}>
                          {option.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {loading ? (
              <div className="flex min-h-[430px] items-center justify-center rounded-xl border border-zinc-200 bg-white">
                <LoadingSpinner size="large" text="正在加载停车场余位..." />
              </div>
            ) : filteredLots.length === 0 ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-zinc-600">
                <SlidersHorizontal className="mx-auto h-8 w-8 text-zinc-400" />
                <p className="mt-3 font-semibold text-zinc-950">没有匹配的停车场</p>
                <p className="mt-2 text-sm">换一个关键词或切换数据来源试试。</p>
              </div>
            ) : (
              <section id="parking-lot-list" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-950">可选停车场</h2>
                    <p className="mt-1 text-sm text-zinc-500">{filteredLots.length} 个结果，点击查看服务详情</p>
                  </div>
                  <span className="hidden rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-500 sm:inline-flex">
                    {sortOptions.find((option) => option.value === sortMode)?.label || '推荐'}排序
                  </span>
                </div>
                {filteredLots.map((lot, index) => (
                  <LotRow
                    key={lot.id}
                    lot={lot}
                    index={index}
                    recommendedLot={recommendedLot}
                    selectedLot={selectedLot}
                    onSelectLot={openLotDetails}
                  />
                ))}
              </section>
            )}
          </div>

          <aside className="space-y-4 xl:sticky xl:top-[88px] xl:self-start">
            <ParkingMap
              lots={filteredLots}
              recommendedLotId={recommendedLot?.id}
              selectedLotId={selectedLot?.id}
              selectedLot={selectedLot}
              onSelectLot={openLotDetails}
            />

            <SelectedLotPanel
              lot={selectedLot}
              recommendedLot={recommendedLot}
              className="hidden xl:block"
              showFullDetailsButton
              onOpenDetails={() => setIsDetailOpen(true)}
            />

            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                数据边界
              </div>
              <PilotBoundaryNote className="mt-3 text-sm leading-6" />
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                当前提示
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-zinc-200 p-3">
                  <p className="text-2xl font-semibold text-zinc-950">{summary.busyLots}</p>
                  <p className="mt-1 text-xs text-zinc-500">偏紧张</p>
                </div>
                <div className="rounded-lg border border-zinc-200 p-3">
                  <p className="text-2xl font-semibold text-zinc-950">{summary.distanceKnown}</p>
                  <p className="mt-1 text-xs text-zinc-500">有坐标</p>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </main>
      )}

      <MobileParkingActionBar lot={selectedLot} onOpenDetails={() => setIsDetailOpen(true)} />
      <ParkGovAgentLauncher onOpen={() => setIsAgentOpen(true)} hasSelectedLot={Boolean(selectedLot)} />
      <Chatbot
        isOpen={isAgentOpen}
        onClose={() => setIsAgentOpen(false)}
        context={agentContext}
      />
      <ParkingLotDetailDrawer
        lot={selectedLot}
        recommendedLot={recommendedLot}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
      />
    </div>
  );
};

export default ParkingLotsPage;
