import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  Bot,
  ChevronRight,
  Check,
  CircleDollarSign,
  Clock3,
  Clipboard,
  Database,
  ExternalLink,
  Filter,
  Flag,
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
import BrandMark, { PilotBoundaryNote } from '../components/BrandMark';
import Chatbot from '../components/Chatbot';

const defaultMapStyleUrl = 'https://tiles.openfreemap.org/styles/positron';
const realMapEnabled = import.meta.env.VITE_ENABLE_REAL_MAP !== 'false';

const withParkingRequestTimeout = (promise, label, timeoutMs = 65000) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} 请求超时`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
};

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
    label: 'AI 推荐',
    description: '自动综合余位、距离',
    icon: Sparkles
  },
  {
    value: 'nearest',
    label: 'AI 近距离',
    description: '距离更近优先',
    icon: MapPin
  },
  {
    value: 'available',
    label: 'AI 余位多',
    description: '空位更稳优先',
    icon: Navigation
  },
  {
    value: 'comfortable',
    label: 'AI 更宽松',
    description: '低占用优先',
    icon: Gauge
  }
];

const getMetadata = (lot) => ({
  ...(lot?.slot_configuration?.metadata || {}),
  ...(lot?.metadata || {})
});

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

const shouldNavigateInSameTab = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  const isNarrowViewport = window.matchMedia?.('(max-width: 768px)').matches;
  const isMobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator?.userAgent || '');

  return Boolean(isNarrowViewport || isMobileUserAgent);
};

const openNavigation = (lot, provider = 'amap', options = {}) => {
  const links = getExternalNavigationLinks(lot);
  const link = links.find((item) => item.id === provider) || links[0];

  if (!link) {
    return false;
  }

  const useSameTab = options.sameTab ?? shouldNavigateInSameTab();

  if (useSameTab) {
    window.location.assign(link.href);
    return true;
  }

  const openedWindow = window.open(link.href, '_blank', 'noopener,noreferrer');
  if (!openedWindow) {
    window.location.assign(link.href);
  }

  return true;
};

const copyToClipboard = async (text) => {
  if (!text) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Some in-app browsers expose clipboard APIs but still block writes.
    }
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textArea);

  return copied;
};

const extractHourlyRate = (feeRule = '') => {
  if (!feeRule) {
    return null;
  }

  if (feeRule.includes('免费')) {
    return 0;
  }

  const patterns = [
    /每小时\s*(\d+(?:\.\d+)?)\s*元/,
    /(\d+(?:\.\d+)?)\s*元\s*\/\s*小时/,
    /(\d+(?:\.\d+)?)\s*元\s*每小时/
  ];

  for (const pattern of patterns) {
    const match = feeRule.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
};

const getPaymentEstimate = (lot, hours = 2) => {
  const feeRule = lot?.metadata?.fee_rule || '';
  const hourlyRate = extractHourlyRate(feeRule);

  if (hourlyRate === null) {
    return {
      amount: null,
      label: '待停车场确认',
      detail: feeRule || '暂无收费规则，本轮只展示模拟缴费入口。',
      hourlyRate
    };
  }

  const amount = Math.round(hourlyRate * hours * 100) / 100;
  return {
    amount,
    label: amount === 0 ? '0 元' : `约 ${amount.toFixed(amount % 1 === 0 ? 0 : 2)} 元`,
    detail: amount === 0 ? '该规则包含免费口径，本页不发起真实扣款。' : `${hourlyRate} 元/小时 × ${hours} 小时，仅作费用预估。`,
    hourlyRate
  };
};

const createPaymentReceipt = (lot, estimate, hours) => {
  const timestamp = new Date();
  const suffix = `${timestamp.getFullYear()}${String(timestamp.getMonth() + 1).padStart(2, '0')}${String(timestamp.getDate()).padStart(2, '0')}${String(timestamp.getHours()).padStart(2, '0')}${String(timestamp.getMinutes()).padStart(2, '0')}${String(timestamp.getSeconds()).padStart(2, '0')}`;
  return {
    id: `PG-SIM-${lot?.id || 'LOT'}-${suffix}`,
    lotName: lot?.name || '停车场',
    amountLabel: estimate?.label || '金额待确认',
    hours,
    createdAt: timestamp.toLocaleString('zh-CN', { hour12: false })
  };
};

const getParkingInfoText = (lot) => {
  if (!lot) {
    return '';
  }

  return [
    `停车场：${lot.name}`,
    `余位：${lot.stats.available}/${lot.stats.total}`,
    `距离：${formatDistance(lot.distanceKm)}`,
    `收费：${lot.metadata.fee_rule || '暂无收费标准'}`,
    `地址：${lot.metadata.address || '暂无地址'}`,
    `来源：${lot.sourceLabel}`
  ].join('\n');
};

const getPaymentReceiptText = (receipt) => {
  if (!receipt) {
    return '';
  }

  return [
    'ParkGov AI 模拟缴费凭证',
    `凭证号：${receipt.id}`,
    `停车场：${receipt.lotName}`,
    `停车时长：${receipt.hours} 小时`,
    `预估金额：${receipt.amountLabel}`,
    `生成时间：${receipt.createdAt}`,
    '说明：该凭证仅用于演示，不产生真实订单或扣款。'
  ].join('\n');
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
    : '按空位、距离、拥挤程度和收费信息展示';
};

const getServiceDecisionReasons = (lot) => {
  if (!lot) {
    return [];
  }

  const confidence = getDataConfidence(lot);
  return [
    lot.stats.available >= 20 ? '空位充足' : lot.stats.available > 5 ? '仍有余位' : '余位偏紧',
    lot.distanceKm === null ? '距离待核验' : lot.distanceKm <= 3 ? '距离较近' : '距离可接受',
    confidence.score >= 75 ? '数据较新' : '建议出发前复核',
    lot.metadata.fee_rule ? '收费清楚' : '收费待补充'
  ];
};

const getQuickPickTone = (rank) => {
  if (!rank) {
    return {
      eyebrow: 'AI 已选好',
      ring: 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white',
      icon: 'bg-emerald-600 text-white',
      action: 'bg-emerald-600 text-white hover:bg-emerald-700',
      badge: 'border-emerald-200 bg-white text-emerald-700'
    };
  }
  if (rank === 'A') {
    return {
      eyebrow: 'Plan B',
      ring: 'border-lime-200 bg-gradient-to-br from-lime-50 via-white to-white',
      icon: 'bg-lime-500 text-white',
      action: 'bg-lime-600 text-white hover:bg-lime-700',
      badge: 'border-lime-200 bg-white text-lime-700'
    };
  }
  return {
    eyebrow: 'Plan C',
    ring: 'border-zinc-200 bg-white',
    icon: 'bg-zinc-900 text-white',
    action: 'bg-zinc-950 text-white hover:bg-zinc-800',
    badge: 'border-zinc-200 bg-zinc-50 text-zinc-700'
  };
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
      label: '空位充足',
      value: availabilityScore,
      detail: `${lot.stats.available}/${lot.stats.total} 个车位可用`
    },
    {
      id: 'distance',
      label: '距离合适',
      value: distanceScore,
      detail: lot.distanceKm === null ? '坐标待核验' : `${formatDistance(lot.distanceKm)} 参考距离`
    },
    {
      id: 'diversion',
      label: '不太拥挤',
      value: diversionScore,
      detail: `占用率 ${lot.stats.occupancy}%`
    },
    {
      id: 'trust',
      label: '数据状态',
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
      label: 'AI 待推荐',
      detail: '正在等待车场数据',
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
    campus_demo: '校园试点 demo 数据，用于停车服务原型演示，后续可替换为授权采集的校园停车场数据。',
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

const getFallbackArrivalAssurance = (lot) => {
  if (!lot) {
    return null;
  }

  const arrival = getArrivalEstimate(lot);
  const readiness = getServiceReadiness(lot);
  const dataConfidence = getDataConfidence(lot);
  const etaMinutes = lot.distanceKm === null ? null : Math.max(2, Math.round((lot.distanceKm / 18) * 60 + 3));
  const probability = Math.round(Math.max(8, Math.min(
    96,
    (lot.stats.total > 0 ? (lot.stats.available / lot.stats.total) * 56 : 8)
      + Math.max(0, 100 - lot.stats.occupancy) * 0.2
      + dataConfidence.score * 0.18
      + (lot.distanceKm === null ? 0 : Math.max(0, 16 - Math.min(lot.distanceKm, 12)))
  )));

  return {
    probability,
    risk: {
      label: readiness.label,
      level: readiness.label === '建议前往' ? 'low' : readiness.label === '仅供验证' ? 'demo_only' : 'medium',
      description: readiness.detail
    },
    eta_minutes: etaMinutes,
    data_age_hours: null,
    freshness_score: dataConfidence.score,
    ai_confidence_score: dataConfidence.score,
    reason: `${probability}% 可停参考；${getRecommendationReason(lot)}`,
    alternatives: []
  };
};

const getArrivalAssurance = (lot) => lot?.arrivalAssurance || getFallbackArrivalAssurance(lot);

const getAlternativeLots = (lots, baseLot, limit = 3) => {
  const baseLotId = baseLot?.id === undefined || baseLot?.id === null ? null : String(baseLot.id);

  return lots
    .filter((lot) => lot && String(lot.id) !== baseLotId)
    .map((lot) => {
      const assurance = getArrivalAssurance(lot);
      const coordinateBonus = hasNavigableCoordinates(lot) ? 10 : -18;
      const demoPenalty = lot.sourceType === 'ai_dataset_demo' || lot.sourceType === 'demo' ? -42 : 0;
      const distanceBonus = lot.distanceKm === null ? -18 : Math.max(0, 18 - Math.min(lot.distanceKm, 18));
      const score =
        (assurance?.probability || 0) * 2.4 +
        lot.stats.available * 0.55 +
        Math.max(0, 100 - lot.stats.occupancy) * 0.24 +
        distanceBonus +
        coordinateBonus +
        demoPenalty;

      return {
        lot,
        score
      };
    })
    .sort((first, second) => (
      second.score - first.score
      || (getArrivalAssurance(second.lot)?.probability || 0) - (getArrivalAssurance(first.lot)?.probability || 0)
      || (first.lot.distanceKm ?? 9999) - (second.lot.distanceKm ?? 9999)
    ))
    .slice(0, limit)
    .map((entry) => entry.lot);
};

const getDecisionLabel = (status) => {
  const labels = {
    go_now: '继续前往',
    keep_backup: '保留备选',
    demo_only: '仅供验证',
    coordinate_missing: '坐标待核验'
  };
  return labels[status] || '待判断';
};

const getArrivalTone = (assurance) => {
  const level = assurance?.risk?.level;
  if (level === 'low') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (level === 'high' || level === 'coordinate_missing') return 'border-red-200 bg-red-50 text-red-700';
  if (level === 'demo_only') return 'border-sky-200 bg-sky-50 text-sky-700';
  return 'border-amber-200 bg-amber-50 text-amber-800';
};

const getAiSignal = (lot) => {
  if (!lot) {
    return {
      score: 0,
      label: 'AI 待机',
      detail: 'AI 正在等待车场数据',
      mode: 'standby'
    };
  }

  const assurance = getArrivalAssurance(lot);
  const confidence = getDataConfidence(lot);
  const score = Math.round(Math.max(0, Math.min(
    99,
    Number(assurance?.ai_confidence_score ?? assurance?.freshness_score ?? confidence.score ?? getTrustScore(lot.sourceType))
  )));
  const hasAiEvent = lot.sourceType === 'ai_dataset_demo' || lot.sourceType === 'campus_camera';
  const mode = hasAiEvent ? 'vision' : lot.sourceType?.includes('beijing') ? 'open-data' : 'fusion';

  return {
    score,
    mode,
    label: hasAiEvent ? 'AI视觉已写回' : 'AI融合判断',
    detail: hasAiEvent
      ? '图片/视频识别结果参与余位展示'
      : '按余位、距离、拥挤度和数据来源计算到场风险'
  };
};

const enrichLot = (lot, recommendationMap = new Map()) => {
  const metadata = getMetadata(lot);
  const stats = getStats(lot);
  const recommendation = recommendationMap.get(String(lot.id));
  const recommendationMetadata = getMetadata(recommendation);
  const latitude = toNumber(
    lot.latitude
    ?? metadata.latitude
    ?? recommendation?.latitude
    ?? recommendationMetadata.latitude
  );
  const longitude = toNumber(
    lot.longitude
    ?? metadata.longitude
    ?? recommendation?.longitude
    ?? recommendationMetadata.longitude
  );
  const distanceKm = getDistanceKm(referenceLocation, { latitude, longitude });
  const sourceType = metadata.source_type || recommendation?.source_type || recommendationMetadata.source_type || 'demo';
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
    recommendationScore: Math.round(recommendationScore * 10) / 10,
    arrivalAssurance: recommendation ? {
      probability: recommendation.probability,
      risk: recommendation.risk,
      eta_minutes: recommendation.eta_minutes,
      data_age_hours: recommendation.data_age_hours,
      freshness_score: recommendation.freshness_score,
      ai_confidence_score: recommendation.ai_confidence_score,
      assurance_breakdown: recommendation.assurance_breakdown,
      decision_status: recommendation.decision_status,
      reason: recommendation.reason,
      alternatives: recommendation.alternatives || []
    } : null
  };
};

const SourceBadge = ({ lot, compact = false }) => (
  <span className={`inline-flex items-center rounded-md border ${compact ? 'px-2 py-0.5' : 'px-2.5 py-1'} text-xs font-medium ${sourceStyles[lot.sourceType] || sourceStyles.demo}`}>
    <Database className="mr-1 h-3.5 w-3.5" />
    {lot.sourceLabel}
  </span>
);

const AiSignalBadge = ({ lot, compact = false, dark = false }) => {
  const signal = getAiSignal(lot);
  const shellClassName = dark
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  return (
    <span className={`inline-flex items-center rounded-md border font-semibold ${compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'} ${shellClassName}`}>
      <Bot className="mr-1.5 h-3.5 w-3.5" />
      {signal.label}
      <span className={`ml-1.5 rounded bg-white/70 px-1.5 py-0.5 ${dark ? 'text-emerald-950' : 'text-emerald-800'}`}>
        {signal.score}%
      </span>
    </span>
  );
};

const AiReasoningStrip = ({ lot, compact = false, dark = false }) => {
  if (!lot) {
    return null;
  }

  const signal = getAiSignal(lot);
  const assurance = getArrivalAssurance(lot);
  const items = [
    { label: '余位', value: `${lot.stats.available}/${lot.stats.total}` },
    { label: '可停', value: `${assurance?.probability ?? 0}%` },
    { label: 'AI 信号', value: `${signal.score}%` }
  ];

  return (
    <div className={`rounded-xl border ${dark ? 'border-white/10 bg-white/10' : 'border-emerald-100 bg-emerald-50/80'} ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`flex items-center gap-2 text-xs font-semibold ${dark ? 'text-emerald-200' : 'text-emerald-800'}`}>
            <Bot className="h-4 w-4" />
            AI 到场判断
          </div>
          <p className={`mt-1 text-xs leading-5 ${dark ? 'text-zinc-300' : 'text-emerald-900'}`}>
            {signal.detail}
          </p>
        </div>
        <span className={`flex-none rounded-md px-2 py-1 text-xs font-semibold ${dark ? 'bg-emerald-300 text-zinc-950' : 'bg-emerald-700 text-white'}`}>
          {signal.score}%
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {items.map((item) => (
          <div key={item.label} className={`rounded-lg px-2 py-2 ${dark ? 'bg-black/20' : 'bg-white/80'}`}>
            <p className={`text-[11px] ${dark ? 'text-zinc-400' : 'text-emerald-800'}`}>{item.label}</p>
            <p className={`mt-1 text-sm font-semibold ${dark ? 'text-white' : 'text-zinc-950'}`}>{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

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
    <div className={`min-w-0 rounded-2xl border bg-white/80 px-3 py-2 shadow-[0_8px_20px_rgba(15,23,42,0.04)] ${borderClassName}`}>
      <div className={`flex items-center gap-1.5 text-xs font-medium ${labelClassName}`}>
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <p className={`mt-1 text-2xl font-semibold leading-none ${toneClassName}`}>{value}</p>
      {subtext && <p className={`mt-1 truncate text-xs ${subtextClassName}`}>{subtext}</p>}
    </div>
  );
};

const QuickPick = ({ label, lot, icon: Icon, onSelectLot, rank = '' }) => {
  if (!lot) {
    return null;
  }

  const readiness = getServiceReadiness(lot);
  const assurance = getArrivalAssurance(lot);
  const tone = getQuickPickTone(rank);
  const reasons = getServiceDecisionReasons(lot);

  return (
    <article
      className={`group flex min-h-[176px] flex-col justify-between rounded-[28px] border px-4 py-4 text-left shadow-[0_14px_34px_rgba(15,23,42,0.055)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_48px_rgba(16,185,129,0.12)] ${tone.ring}`}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-600">
            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full shadow-[0_10px_20px_rgba(15,23,42,0.10)] ${tone.icon}`}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">{tone.eyebrow}</span>
              <span className="mt-0.5 block text-sm font-semibold text-zinc-950">{label}</span>
            </span>
          </div>
          <p className="mt-3 line-clamp-1 text-base font-semibold text-zinc-950">{lot.name}</p>
        </div>
        <span className={`flex-none rounded-full border px-2.5 py-1 text-xs font-semibold ${readiness.className}`}>
          {readiness.label}
        </span>
      </div>
      <div className="mt-4 grid w-full grid-cols-3 gap-2 rounded-2xl bg-white/75 p-2">
        <div className="rounded-xl bg-emerald-50/80 px-2.5 py-2">
          <p className="text-lg font-semibold leading-none text-emerald-700">{assurance?.probability || 0}%</p>
          <p className="mt-1 text-[11px] text-zinc-500">可停</p>
        </div>
        <div className="rounded-xl bg-white px-2.5 py-2">
          <p className="text-lg font-semibold leading-none text-zinc-950">{lot.stats.available}</p>
          <p className="mt-1 text-[11px] text-zinc-500">余位</p>
        </div>
        <div className="rounded-xl bg-white px-2.5 py-2">
          <p className="text-lg font-semibold leading-none text-zinc-950">{formatDistance(lot.distanceKm)}</p>
          <p className="mt-1 text-[11px] text-zinc-500">距离</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {reasons.map((reason) => (
          <span key={reason} className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.badge}`}>
            {reason}
          </span>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          onClick={() => onSelectLot(lot)}
          className={`inline-flex h-10 items-center justify-center rounded-full px-3 text-xs font-semibold transition ${tone.action}`}
        >
          {rank ? '采纳 AI 备选' : '采纳 AI 首选'}
          <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </button>
        <NavigationButton lot={lot} label="AI导航" className="h-9 px-3 text-xs" />
      </div>
    </article>
  );
};

const AiDecisionHero = ({
  lot,
  alternatives = [],
  analyzedCount = 0,
  activeArrivalIntent = null,
  onOpenDetails,
  onCreateIntent,
  creatingArrivalIntent = false,
  onShowMap,
  onShowAdjust
}) => {
  if (!lot) {
    return (
      <section className="rounded-[30px] border border-emerald-100 bg-white p-5 shadow-[0_18px_46px_rgba(15,23,42,0.07)]">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
          <Bot className="h-4 w-4" />
          AI 停车决策
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-zinc-950">AI 正在等待车场数据</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">连接后端后，系统会自动给出首选车场和备选方案。</p>
      </section>
    );
  }

  const assurance = getArrivalAssurance(lot);
  const readiness = getServiceReadiness(lot);
  const planB = alternatives.find((candidate) => String(candidate.id) !== String(lot.id)) || null;
  const planBAssurance = planB ? getArrivalAssurance(planB) : null;
  const guardian = activeArrivalIntent ? getArrivalIntentGuard(activeArrivalIntent) : null;
  const serviceStates = [
    { label: 'AI 已为你选择', detail: `${assurance?.probability || 0}% 可停`, icon: Sparkles, active: true },
    { label: '当前建议前往', detail: readiness.label, icon: Navigation, active: readiness.label !== '暂不前往' },
    { label: 'Plan B 可承接', detail: planB ? planB.name : '待匹配', icon: ShieldCheck, active: Boolean(planB) },
    { label: '到场守护中', detail: guardian?.label || '生成后开启', icon: Clock3, active: Boolean(activeArrivalIntent) }
  ];

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-emerald-100 bg-white p-4 shadow-[0_18px_44px_rgba(15,23,42,0.07)] sm:p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_30%),linear-gradient(135deg,rgba(240,253,244,0.72),rgba(255,255,255,0.34))]" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-[0_10px_20px_rgba(16,185,129,0.22)]">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            AI 首选
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-emerald-100 bg-white/80 px-3 py-1 text-xs font-semibold text-emerald-800">
              已分析 {analyzedCount} 个车场
            </span>
            <AiSignalBadge lot={lot} compact />
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px] lg:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">AI 停车决策</p>
            <h1 className="mt-2 text-[24px] font-semibold leading-tight text-zinc-950 sm:text-3xl">
              {lot.name}
            </h1>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-600 lg:line-clamp-1">
              {assurance?.reason || getRecommendationReason(lot)}
            </p>
          </div>

          <div className="rounded-[22px] border border-white/80 bg-white/90 p-3 shadow-[0_12px_26px_rgba(15,23,42,0.07)]">
            <p className="text-xs font-semibold text-zinc-500">到场可停概率</p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-3xl font-semibold leading-none text-emerald-700">{assurance?.probability || 0}%</span>
              <span className={`mb-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${getArrivalTone(assurance)}`}>
                {assurance?.risk?.label || '待判断'}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 rounded-[24px] border border-emerald-50 bg-white/70 p-2">
          <div className="rounded-2xl bg-emerald-50/80 px-3 py-3">
            <p className="text-2xl font-semibold leading-none text-emerald-700">{lot.stats.available}</p>
            <p className="mt-1 text-xs text-zinc-500">剩余车位</p>
          </div>
          <div className="rounded-2xl bg-white px-3 py-3">
            <p className="text-2xl font-semibold leading-none text-zinc-950">{formatDistance(lot.distanceKm)}</p>
            <p className="mt-1 text-xs text-zinc-500">参考距离</p>
          </div>
          <div className="rounded-2xl bg-white px-3 py-3">
            <p className="truncate text-2xl font-semibold leading-none text-zinc-950">{getArrivalEstimate(lot).label}</p>
            <p className="mt-1 text-xs text-zinc-500">预计到达</p>
          </div>
        </div>

        <div className="mt-3 grid gap-1.5 rounded-[22px] border border-emerald-100 bg-white/80 p-1.5 text-[11px] font-semibold text-zinc-600 shadow-[0_10px_24px_rgba(16,185,129,0.07)] sm:grid-cols-4">
          {serviceStates.map((step) => {
            const Icon = step.icon;
            return (
              <span
                key={step.label}
                className={`inline-flex min-w-0 items-center gap-2 rounded-[18px] px-2.5 py-2 ${
                  step.active ? 'bg-emerald-50 text-emerald-800' : 'text-zinc-500'
                }`}
              >
                <Icon className="h-3.5 w-3.5 flex-none" />
                <span className="min-w-0">
                  <span className="block truncate">{step.label}</span>
                  <span className={`mt-0.5 block truncate text-[10px] font-medium ${step.active ? 'text-emerald-700/80' : 'text-zinc-400'}`}>
                    {step.detail}
                  </span>
                </span>
              </span>
            );
          })}
        </div>

        <div className="mt-4 rounded-[24px] border border-emerald-100 bg-white/80 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-950">出发前建议</p>
              <p className="mt-1 truncate text-xs text-zinc-500">
                {activeArrivalIntent
                  ? `到场守护：${guardian?.label || '出发中'} · 余位变化会提示是否切换`
                  : planB
                    ? `Plan B：${planB.name} · 可停 ${planBAssurance?.probability || 0}%`
                    : '暂无更稳备选，建议先查看地图'}
              </p>
            </div>
            <span className={`flex-none rounded-full border px-2.5 py-1 text-xs font-semibold ${readiness.className}`}>
              {readiness.label}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <NavigationButton lot={lot} label="AI导航" className="h-11 min-w-[128px] px-4 text-sm" />
            <button
              type="button"
              onClick={() => onCreateIntent?.(lot)}
              disabled={creatingArrivalIntent}
              className="inline-flex h-11 min-w-[112px] items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingArrivalIntent ? '生成中' : 'AI到场码'}
            </button>
            <button
              type="button"
              onClick={() => onOpenDetails?.(lot)}
              className="hidden h-11 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 sm:inline-flex"
            >
              查看详情
            </button>
            <button
              type="button"
              onClick={onShowAdjust}
              className="hidden h-11 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 sm:inline-flex"
            >
              调整 AI 停车偏好
            </button>
          </div>
          <button
            type="button"
            onClick={onShowMap}
            className="mt-2 inline-flex h-9 items-center text-xs font-semibold text-emerald-700 sm:hidden"
          >
            查看地图
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </section>
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

const NavigationLinks = ({ lot, compact = false, className = '', onOpenPayment }) => {
  const [copied, setCopied] = useState(false);
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
  const buttonSizeClassName = compact ? 'h-9 px-3 text-xs' : 'h-11 px-4 text-sm';
  const secondaryButtonClassName = compact ? 'h-9 px-3 text-xs' : 'h-11 px-3 text-sm';

  const handleCopy = async () => {
    const ok = await copyToClipboard(primaryLink.href);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openNavigation(lot, primaryLink.id);
          }}
          className={`inline-flex items-center justify-center rounded-md bg-emerald-600 font-semibold text-white transition hover:bg-emerald-700 ${buttonSizeClassName}`}
        >
          <Navigation className="mr-1.5 h-4 w-4" />
          高德导航
          <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
        </button>
        {secondaryLinks.map((link) => (
          <button
            key={link.id}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openNavigation(lot, link.id);
            }}
            className={`inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white font-semibold text-zinc-700 transition hover:bg-zinc-50 ${secondaryButtonClassName}`}
          >
            {link.label}
          </button>
        ))}
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleCopy();
          }}
          className={`inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white font-semibold text-zinc-700 transition hover:bg-zinc-50 ${secondaryButtonClassName}`}
        >
          {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> : <Clipboard className="mr-1.5 h-3.5 w-3.5" />}
          {copied ? '已复制' : '复制链接'}
        </button>
        {onOpenPayment && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenPayment(lot);
            }}
            className={`inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white font-semibold text-zinc-700 transition hover:bg-zinc-50 ${secondaryButtonClassName}`}
          >
            <WalletCards className="mr-1.5 h-3.5 w-3.5" />
            模拟缴费
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-5 text-zinc-500">
        将跳转外部地图；移动端会在当前页打开，高德为主入口。ParkGov AI 不请求定位、不做预约或支付。
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
        openNavigation(lot, 'amap');
      }}
      title={canNavigate ? '打开高德外部导航' : '该停车场坐标待核验'}
      className={`inline-flex min-w-0 items-center justify-center rounded-full font-semibold transition ${
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
        title: '更宽松',
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
          <p className="text-xs font-semibold tracking-[0.16em] text-emerald-700">备选方案</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-950">更宽松的停车选择</h2>
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
          <p className="text-xs font-semibold text-emerald-700">AI 推荐停车</p>
          <p className="mt-2 truncate text-sm font-semibold text-emerald-950">{recommendedLot.name}</p>
          <p className="mt-1 text-xs text-emerald-800">
            {formatDistance(recommendedLot.distanceKm)} · 占用 {recommendedLot.stats.occupancy}% · 余位 {recommendedLot.stats.available}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs leading-5 text-zinc-500">
        {comparisonLot && !nearestIsRecommended && pressureGap > 0
          ? `与最近点相比，当前推荐占用率低约 ${pressureGap} 个百分点，更适合作为宽松备选。`
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
            <p className="text-xs font-semibold tracking-[0.16em] text-zinc-400">行前服务</p>
            <ServiceBadge lot={lot} />
          </div>
          <h2 className="mt-1 text-lg font-semibold text-zinc-950">现在是否适合去</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            {isRecommended ? 'AI 当前首选' : 'AI 已切换关注'}：{getRecommendationReason(lot)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NavigationButton lot={lot} label="AI导航" className="h-10 px-4 text-sm" />
          <button
            type="button"
            onClick={onOpenDetails}
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
          >
            采纳AI建议
            <ArrowRight className="ml-2 h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <ReadinessTile icon={Clock3} label="到达预估" value={arrival.label} detail={arrival.detail} />
        <ReadinessTile icon={ShieldCheck} label="前往建议" value={readiness.label} detail={readiness.detail} tone={readinessTone} />
        <ReadinessTile icon={Database} label="数据状态" value={confidence.label} detail={confidence.detail} tone="info" />
      </div>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-zinc-950">AI推荐依据</p>
          <p className="text-xs text-zinc-500">空位、距离、拥挤程度、数据状态</p>
        </div>
        <div className="mt-4">
          <RecommendationBreakdown lot={lot} />
        </div>
      </div>
    </section>
  );
};

const ArrivalAssuranceCard = ({ lot, alternatives = [], onCreateIntent, onOpenLot }) => {
  if (!lot) {
    return null;
  }

  const assurance = getArrivalAssurance(lot);
  const arrival = getArrivalEstimate(lot);
  const probability = assurance?.probability ?? 0;

  return (
    <section className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
      <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-emerald-700">到场保障</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950">现在过去，还有位吗？</h2>
            <p className="mt-1 text-sm leading-6 text-emerald-900">
              {assurance?.reason || `${lot.stats.available} 个余位，${arrival.label} 可达。`}
            </p>
          </div>
          <span className={`inline-flex rounded-lg border px-3 py-2 text-sm font-semibold ${getArrivalTone(assurance)}`}>
            {assurance?.risk?.label || '待判断'}
          </span>
        </div>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-3">
        <ReadinessTile icon={ShieldCheck} label="可停概率" value={`${probability}%`} detail="MVP 评分，不代表真实锁位" tone={probability >= 70 ? 'success' : 'warning'} />
        <ReadinessTile icon={Clock3} label="预计到达" value={assurance?.eta_minutes ? `约 ${assurance.eta_minutes} 分钟` : arrival.label} detail={arrival.detail} />
        <ReadinessTile icon={Database} label="数据新鲜度" value={assurance?.data_age_hours === null || assurance?.data_age_hours === undefined ? '待补充' : `${assurance.data_age_hours} 小时`} detail="综合 AI 事件、开放数据和导入时间" tone="info" />
      </div>

      <div className="border-t border-zinc-100 px-4 pb-4 pt-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-zinc-600">
            {assurance?.risk?.description || '用于判断到场风险；不做真实预约或车位锁定。'}
          </p>
          <button
            type="button"
            onClick={() => onCreateIntent?.(lot)}
            className="inline-flex h-10 flex-none items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
          >
            生成到场计划
          </button>
        </div>

        {alternatives.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-zinc-500">备选车场</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {alternatives.slice(0, 2).map((candidate, index) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => onOpenLot?.(candidate)}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-left transition hover:bg-white"
                >
                  <p className="text-xs font-semibold text-zinc-500">Plan {index === 0 ? 'B' : 'C'} · {getArrivalAssurance(candidate)?.probability || 0}%</p>
                  <p className="mt-1 truncate text-sm font-semibold text-zinc-950">{candidate.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">{candidate.stats.available} 个余位 · {formatDistance(candidate.distanceKm)}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

const formatArrivalIntentText = (intent) => {
  if (!intent) {
    return '';
  }

  const snapshot = intent.lot_snapshot || {};
  return [
    'ParkGov AI 到场计划',
    `到场码：${intent.display_code}`,
    `停车场：${snapshot.name || '停车场'}`,
    `预计到达：${intent.estimated_arrival_minutes} 分钟`,
    `预计停留：${intent.expected_duration_minutes} 分钟`,
    `可停概率：${snapshot.probability ?? '--'}%`,
    `当前余位：${snapshot.available_slots ?? '--'}`,
    `风险：${snapshot.risk?.label || '待判断'}`,
    intent.current_assurance ? `当前可停概率：${intent.current_assurance.probability ?? '--'}%` : null,
    intent.snapshot_delta ? `余位变化：${intent.snapshot_delta.available_slots_delta >= 0 ? '+' : ''}${intent.snapshot_delta.available_slots_delta}` : null,
    intent.switch_recommendation?.should_switch ? `建议切换：${intent.switch_recommendation.suggested_lot?.name || 'Plan B'}` : null,
    `有效期：${intent.expires_at ? new Date(intent.expires_at).toLocaleString('zh-CN', { hour12: false }) : '待生成'}`,
    intent.disclaimer || '该到场计划仅用于演示，不锁位、不扣款、不代表真实预约。'
  ].filter(Boolean).join('\n');
};

const getArrivalIntentTiming = (intent) => {
  if (!intent) {
    return {
      expired: false,
      progress: 0,
      remainingMinutes: null,
      etaRemainingMinutes: null
    };
  }

  const now = Date.now();
  const createdAt = intent.created_at ? new Date(intent.created_at).getTime() : now;
  const expiresAt = intent.expires_at ? new Date(intent.expires_at).getTime() : null;
  const etaAt = createdAt + Number(intent.estimated_arrival_minutes || 0) * 60 * 1000;
  const totalMs = expiresAt ? Math.max(expiresAt - createdAt, 1) : 1;
  const elapsedMs = Math.max(now - createdAt, 0);
  const remainingMs = expiresAt ? expiresAt - now : null;

  return {
    expired: expiresAt ? remainingMs <= 0 : false,
    progress: Math.max(0, Math.min(100, Math.round((elapsedMs / totalMs) * 100))),
    remainingMinutes: remainingMs === null ? null : Math.max(0, Math.ceil(remainingMs / 60000)),
    etaRemainingMinutes: Number(intent.estimated_arrival_minutes || 0) > 0
      ? Math.max(0, Math.ceil((etaAt - now) / 60000))
      : null
  };
};

const getArrivalIntentGuard = (intent) => {
  const timing = getArrivalIntentTiming(intent);
  const switchRecommendation = intent?.switch_recommendation || null;
  const currentAssurance = intent?.current_assurance || null;

  if (timing.expired || intent?.status === 'expired') {
    return {
      label: '已过期',
      description: '这张到场码已超过演示有效期，建议重新生成。',
      className: 'border-zinc-200 bg-zinc-50 text-zinc-700',
      barClassName: 'bg-zinc-400'
    };
  }

  if (switchRecommendation?.should_switch) {
    return {
      label: '建议看 Plan B',
      description: switchRecommendation.reason || '当前余位或数据状态变化，建议检查备选停车场。',
      className: 'border-amber-200 bg-amber-50 text-amber-900',
      barClassName: 'bg-amber-500'
    };
  }

  if (currentAssurance?.decision_status === 'coordinate_missing' || currentAssurance?.decision_status === 'demo_only') {
    return {
      label: getDecisionLabel(currentAssurance.decision_status),
      description: currentAssurance.risk?.description || '该计划仍可用于演示，但真实出行前需要补齐数据边界。',
      className: 'border-sky-200 bg-sky-50 text-sky-900',
      barClassName: 'bg-sky-500'
    };
  }

  return {
    label: '出发中',
    description: '当前到场风险未明显升高，可继续按演示计划前往。',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    barClassName: 'bg-emerald-500'
  };
};

const RecommendedPlan = ({
  lot,
  alternatives = [],
  onOpenDetails,
  onCreateIntent,
  creatingArrivalIntent = false
}) => {
  if (!lot) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <p className="text-sm font-semibold text-zinc-950">暂无 AI 推荐车场</p>
        <p className="mt-2 text-sm text-zinc-500">请换一个目的地关键词，或恢复 AI 融合全部来源。</p>
      </div>
    );
  }

  const crowdStatus = getCrowdStatus(lot.stats.occupancy);
  const assurance = getArrivalAssurance(lot);
  const arrival = getArrivalEstimate(lot);
  const probability = assurance?.probability || 0;
  const riskLabel = assurance?.risk?.label || '待判断';

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="group block w-full rounded-2xl border border-emerald-100 bg-white p-4 text-left shadow-[0_14px_40px_rgba(15,23,42,0.06)] transition hover:border-emerald-200 hover:shadow-md sm:p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-emerald-950 px-2.5 py-1 text-xs font-semibold text-white">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              AI 首选
            </span>
            <AiSignalBadge lot={lot} compact />
            <ServiceBadge lot={lot} />
            <span className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${getArrivalTone(assurance)}`}>
              可停 {probability}%
            </span>
          </div>
          <h2 className="mt-3 text-[22px] font-semibold leading-tight text-zinc-950 sm:mt-4 sm:text-2xl">{lot.name}</h2>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-600">
            {lot.metadata.district || '未知区域'} · {lot.metadata.address || '暂无地址'}
          </p>
        </div>
        <NavigationButton lot={lot} label="AI 导航" className="hidden h-10 px-3 text-xs sm:inline-flex" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:grid-cols-4">
        <div className="rounded-xl bg-emerald-50 px-3 py-3">
          <p className="text-xl font-semibold leading-none text-emerald-700 sm:text-2xl">{probability}%</p>
          <p className="mt-1 text-xs text-emerald-800">预计可停</p>
        </div>
        <div className="rounded-xl bg-zinc-50 px-3 py-3">
          <p className="text-xl font-semibold leading-none text-zinc-950 sm:text-2xl">{lot.stats.available}</p>
          <p className="mt-1 text-xs text-zinc-500">剩余车位</p>
        </div>
        <div className="rounded-xl bg-zinc-50 px-3 py-3">
          <p className="text-xl font-semibold leading-none text-zinc-950 sm:text-2xl">{arrival.label}</p>
          <p className="mt-1 text-xs text-zinc-500">预计到达</p>
        </div>
        <div className="rounded-xl bg-amber-50 px-3 py-3">
          <p className="truncate text-xl font-semibold leading-none text-amber-700 sm:text-2xl">{riskLabel}</p>
          <p className="mt-1 text-xs text-amber-700">{lot.stats.occupancy}% 占用</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-4">
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

      <div className="mt-4 rounded-xl border border-zinc-200 bg-[#f8faf8] p-3">
        <p className="text-xs font-semibold text-zinc-500">AI 到场判断</p>
        <p className="mt-1 text-sm leading-6 text-zinc-700 sm:block">
          {assurance?.reason || getRecommendationReason(lot)}
        </p>
        <div className="mt-3">
          <AiReasoningStrip lot={lot} compact />
        </div>
        <div className="mt-3 hidden gap-2 sm:grid sm:grid-cols-[1fr_auto_auto]">
          <button
            type="button"
            onClick={() => onOpenDetails(lot)}
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
          >
            采纳 AI 首选
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onCreateIntent?.(lot)}
            disabled={creatingArrivalIntent}
            className="inline-flex h-10 items-center justify-center rounded-md border border-emerald-700 bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShieldCheck className="mr-1.5 h-4 w-4" />
            {creatingArrivalIntent ? '生成中' : 'AI 到场码'}
          </button>
          <NavigationButton lot={lot} label="按 AI 导航" className="h-10 px-3 text-sm" />
        </div>
      </div>

      {alternatives.length > 0 && (
        <div className="mt-4 hidden gap-2 sm:grid sm:grid-cols-2">
          {alternatives.slice(0, 2).map((candidate, index) => {
            const candidateAssurance = getArrivalAssurance(candidate);
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onOpenDetails(candidate)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/40"
              >
                <p className="text-xs font-semibold text-zinc-500">Plan {index === 0 ? 'B' : 'C'} · 可停 {candidateAssurance?.probability || 0}%</p>
                <p className="mt-1 truncate text-sm font-semibold text-zinc-950">{candidate.name}</p>
                <p className="mt-1 text-xs text-zinc-500">{candidate.stats.available} 余位 · {formatDistance(candidate.distanceKm)}</p>
              </button>
            );
          })}
        </div>
      )}
    </motion.article>
  );
};

const PaymentEstimateCard = ({ lot, hours, onOpenPayment, compact = false }) => {
  if (!lot) {
    return null;
  }

  const estimate = getPaymentEstimate(lot, hours);

  return (
    <div className={`rounded-lg border border-zinc-200 bg-white ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-zinc-500">收费预估</p>
          <p className={`${compact ? 'mt-1 text-xl' : 'mt-2 text-2xl'} font-semibold text-zinc-950`}>{estimate.label}</p>
        </div>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
          <WalletCards className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{estimate.detail}</p>
      <button
        type="button"
        onClick={() => onOpenPayment?.(lot)}
        className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-md border border-zinc-900 bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800"
      >
        <WalletCards className="mr-2 h-4 w-4" />
        模拟缴费
      </button>
      <p className="mt-2 text-[11px] leading-5 text-zinc-500">
        仅为前端演示，不接入真实微信/支付宝交易，不产生订单扣款。
      </p>
    </div>
  );
};

const ParkingMap = ({
  lots,
  recommendedLotId,
  selectedLotId,
  selectedLot,
  recommendedLot,
  alternatives = [],
  activeArrivalIntent = null,
  creatingArrivalIntent = false,
  onSelectLot,
  onCreateIntent
}) => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const mapLots = lots.filter((lot) => lot.latitude !== null && lot.longitude !== null);
  const mapFocusLots = mapLots.filter((lot) => {
    const sourceType = lot.sourceType || lot.metadata?.source_type;
    return sourceType === 'campus_demo' || sourceType === 'campus_camera' || (lot.distanceKm !== null && lot.distanceKm <= 3.5);
  });
  const viewportLots = mapFocusLots.length > 0 ? mapFocusLots : mapLots;
  const styleUrl = import.meta.env.VITE_MAP_STYLE_URL || defaultMapStyleUrl;

  useEffect(() => {
    if (!realMapEnabled || mapLots.length === 0 || !mapContainerRef.current || mapRef.current) {
      return undefined;
    }

    const centerLng = viewportLots.reduce((sum, lot) => sum + lot.longitude, 0) / viewportLots.length;
    const centerLat = viewportLots.reduce((sum, lot) => sum + lot.latitude, 0) / viewportLots.length;

    try {
      mapRef.current = new maplibregl.Map({
        container: mapContainerRef.current,
        style: styleUrl,
        center: [centerLng, centerLat],
        zoom: viewportLots.length > 1 ? 14 : 15,
        attributionControl: true
      });

      mapRef.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      mapRef.current.on('load', () => {
        mapRef.current?.resize();
        window.setTimeout(() => mapRef.current?.resize(), 120);
        setMapReady(true);
      });
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
  }, [styleUrl, mapLots.length, viewportLots.length]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) {
      return;
    }

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const viewportBounds = new maplibregl.LngLatBounds();

    mapLots.forEach((lot) => {
      const isRecommended = String(lot.id) === String(recommendedLotId);
      const isSelected = String(lot.id) === String(selectedLotId);
      const isBusy = lot.stats.occupancy >= 75;
      const isAlternative = !isRecommended && lot.arrivalAssurance?.decision_status && lot.stats.occupancy < 75;
      const markerElement = document.createElement('button');
      markerElement.type = 'button';
      markerElement.className = [
        'h-5 w-5 rounded-full border-[3px] border-white shadow-[0_10px_24px_rgba(15,23,42,0.22)] transition',
        isSelected ? 'scale-125 ring-4 ring-emerald-500/25 ring-offset-2' : '',
        isRecommended ? 'h-7 w-7 animate-pulse bg-emerald-500 shadow-[0_0_0_9px_rgba(16,185,129,0.18)]' : isBusy ? 'bg-amber-400' : isAlternative ? 'bg-lime-400' : 'bg-teal-500'
      ].join(' ');
      markerElement.setAttribute('aria-label', `${lot.name}，剩余 ${lot.stats.available} 个车位`);
      markerElement.title = `${lot.name}，剩余 ${lot.stats.available} 个车位`;
      markerElement.addEventListener('click', () => onSelectLot?.(lot));

      const marker = new maplibregl.Marker({ element: markerElement, anchor: 'center' })
        .setLngLat([lot.longitude, lot.latitude])
        .addTo(mapRef.current);

      markersRef.current.push(marker);
      if (viewportLots.some((viewportLot) => String(viewportLot.id) === String(lot.id))) {
        viewportBounds.extend([lot.longitude, lot.latitude]);
      }
    });

    if (viewportLots.length === 1) {
      mapRef.current.flyTo({
        center: [viewportLots[0].longitude, viewportLots[0].latitude],
        zoom: 15,
        duration: 500
      });
    } else if (!viewportBounds.isEmpty()) {
      mapRef.current.fitBounds(viewportBounds, {
        padding: 72,
        maxZoom: 15,
        duration: 500
      });
    }
    window.setTimeout(() => mapRef.current?.resize(), 80);
  }, [mapReady, mapLots, viewportLots, onSelectLot, recommendedLotId, selectedLotId]);

  if (mapLots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100">
          <Layers className="h-6 w-6 text-zinc-400" />
        </div>
          <p className="mt-4 font-medium text-zinc-800">AI 暂无可绘制坐标</p>
        <p className="mx-auto mt-2 max-w-xs leading-6">
          坐标缺失不影响 AI 候选排序；补齐经纬度后会自动进入地图推荐。
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
  const recommendedMapLot = mapLots.find((lot) => String(lot.id) === String(recommendedLotId)) || null;
  const featuredMapLot = selectedMapLot || recommendedMapLot || recommendedLot || null;
  const featuredAssurance = featuredMapLot ? getArrivalAssurance(featuredMapLot) : null;
  const planB = alternatives.find((candidate) => featuredMapLot && String(candidate.id) !== String(featuredMapLot.id)) || null;
  const planBAssurance = planB ? getArrivalAssurance(planB) : null;
  const guardian = activeArrivalIntent ? getArrivalIntentGuard(activeArrivalIntent) : null;

  return (
    <div className="overflow-hidden rounded-[30px] border border-emerald-100 bg-white shadow-[0_22px_54px_rgba(15,23,42,0.08)]">
      <div className="border-b border-emerald-50 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-950">附近停车地图</p>
            <p className="mt-0.5 text-xs text-zinc-500">AI 已默认圈出更稳车场，可直接导航或生成到场码</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <span className="hidden items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 sm:inline-flex">
              <Bot className="mr-1 h-3.5 w-3.5" />
              AI 推荐
            </span>
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600">{mapLots.length} 个点位</span>
          </div>
        </div>
      </div>

      <div className="relative h-[430px] w-full overflow-hidden bg-[#edf5ef] sm:h-[500px] xl:h-[620px]">
        <div ref={mapContainerRef} className="h-full w-full" aria-label="停车场交互地图" />
        <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-emerald-100 bg-white/90 px-3 py-2 text-xs text-zinc-700 shadow-[0_12px_28px_rgba(16,185,129,0.12)] backdrop-blur">
          <div className="flex items-center gap-2 font-semibold text-emerald-800">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
            </span>
            AI 正在匹配可停点位
          </div>
        </div>
        {featuredMapLot && (
          <div className="absolute inset-x-3 bottom-3 rounded-[28px] border border-white/80 bg-white/95 p-3 shadow-[0_20px_48px_rgba(15,23,42,0.16)] backdrop-blur">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="inline-flex items-center rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white">
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                AI 已选好
              </span>
              <div className="flex flex-wrap justify-end gap-1.5">
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getArrivalTone(featuredAssurance)}`}>
                  预计可停 {featuredAssurance?.probability || 0}%
                </span>
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  activeArrivalIntent ? guardian?.className || 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-zinc-200 bg-zinc-50 text-zinc-600'
                }`}>
                  {activeArrivalIntent ? `到场守护 ${guardian?.label || '出发中'}` : '可生成到场码'}
                </span>
              </div>
            </div>
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => onSelectLot?.(featuredMapLot)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-[11px] font-semibold text-emerald-700">
                  {String(featuredMapLot.id) === String(recommendedLotId) ? 'AI 首选' : 'AI 已切换关注'}
                </p>
                <p className="mt-1 truncate text-base font-semibold text-zinc-950">{featuredMapLot.name}</p>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  {featuredMapLot.stats.available} 个余位 · {formatDistance(featuredMapLot.distanceKm)} · {getArrivalEstimate(featuredMapLot).label}
                </p>
              </button>
              <div className="flex flex-none flex-col gap-2">
                <NavigationButton lot={featuredMapLot} label="AI导航" className="h-9 rounded-full px-3 text-xs" />
                <button
                  type="button"
                  onClick={() => onCreateIntent?.(featuredMapLot)}
                  disabled={creatingArrivalIntent}
                  className="inline-flex h-9 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creatingArrivalIntent ? '生成中' : '到场码'}
                </button>
              </div>
            </div>
            {planB && (
              <button
                type="button"
                onClick={() => onSelectLot?.(planB)}
                className="mt-3 flex w-full items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3 py-2.5 text-left transition hover:bg-emerald-50"
              >
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold text-emerald-800">Plan B 备选</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-zinc-800">
                    {planB.name} · {planB.stats.available} 余位 · 可停 {planBAssurance?.probability || 0}%
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 flex-none text-emerald-700" />
              </button>
            )}
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] font-semibold text-zinc-500">
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">AI 首选</span>
              <span className="rounded-full bg-lime-50 px-2 py-1 text-lime-700">Plan B 可承接</span>
              <span className="rounded-full bg-zinc-50 px-2 py-1 text-zinc-600">外部地图导航</span>
            </div>
          </div>
        )}
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-zinc-500 backdrop-blur-sm">
            正在加载开放地图底图...
          </div>
        )}
      </div>

      <div className="border-t border-emerald-100 bg-white px-4 py-3">
        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1 rounded-md border border-zinc-100 bg-zinc-50 px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-full bg-teal-600" />
            可停
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-zinc-100 bg-zinc-50 px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-full bg-lime-400" />
            AI备选
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-zinc-100 bg-zinc-50 px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            紧张
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-zinc-100 bg-zinc-50 px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            推荐
          </span>
        </div>
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
  onOpenDetails,
  showActionArea = true,
  isSaved = false,
  isCompared = false,
  creatingArrivalIntent = false,
  paymentHours = 2,
  onOpenPayment,
  onCreateArrivalIntent,
  onToggleSaved,
  onToggleCompare,
  onCopyLot,
  onReportDataIssue
}) => {
  if (!lot) {
    return null;
  }

  const crowdStatus = getCrowdStatus(lot.stats.occupancy);
  const isRecommended = String(lot.id) === String(recommendedLot?.id);
  const readiness = getServiceReadiness(lot);
  const assurance = getArrivalAssurance(lot);
  const paymentEstimate = getPaymentEstimate(lot, paymentHours);

  return (
    <div className={`overflow-hidden rounded-[28px] border border-emerald-100 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.07)] ${className}`}>
      <div className="border-b border-emerald-50 bg-gradient-to-br from-emerald-50 via-white to-white p-4 text-zinc-950">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-emerald-700">AI 停车服务面板</p>
            <h2 className="mt-2 text-lg font-semibold leading-tight">{lot.name}</h2>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-600">
              {lot.metadata.district || '未知区域'} · {lot.metadata.address || '暂无地址'}
            </p>
            <div className="mt-3">
              <AiSignalBadge lot={lot} compact />
            </div>
          </div>
          {isRecommended && (
            <span className="flex-none rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700">
              AI 首选
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-emerald-50 px-3 py-3">
            <p className="text-2xl font-semibold leading-none text-emerald-700">{lot.stats.available}</p>
            <p className="mt-1 text-xs text-zinc-500">剩余</p>
          </div>
          <div className="rounded-2xl bg-white px-3 py-3 shadow-sm">
            <p className="text-xl font-semibold leading-none">{assurance?.probability ?? '--'}%</p>
            <p className="mt-1 text-xs text-zinc-500">可停</p>
          </div>
          <div className="rounded-2xl bg-white px-3 py-3 shadow-sm">
            <p className="text-xl font-semibold leading-none">{formatDistance(lot.distanceKm)}</p>
            <p className="mt-1 text-xs text-zinc-500">距离</p>
          </div>
        </div>
      </div>

      <div className="p-4">
        {showActionArea && (
          <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-2">
            <NavigationButton lot={lot} label="AI导航" className="h-11 px-4 text-sm" />
            <button
              type="button"
              disabled={creatingArrivalIntent}
              onClick={() => onCreateArrivalIntent?.(lot)}
              className="inline-flex h-11 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldCheck className="mr-1.5 h-4 w-4" />
              {creatingArrivalIntent ? '生成中' : 'AI到场码'}
            </button>
          </div>
        )}

        <div className={`mt-4 rounded-lg border px-3 py-2 text-sm font-semibold ${readiness.className}`}>
          {readiness.label} · {readiness.detail}
        </div>

        <div className="mt-4">
          <OccupancyMeter lot={lot} />
        </div>

        <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-emerald-950">到场保障</p>
            <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${getArrivalTone(assurance)}`}>
              {assurance?.risk?.label || '待判断'}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-emerald-900">
            {assurance?.reason || getRecommendationReason(lot)}
          </p>
        </div>

        <div className="mt-4">
          <AiReasoningStrip lot={lot} compact />
        </div>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-zinc-950">AI推荐依据</p>
            <p className="text-xs text-zinc-500">服务条件</p>
          </div>
          <div className="mt-3">
            <RecommendationBreakdown lot={lot} compact />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-zinc-950">费用预估</p>
            <span className="text-sm font-semibold text-zinc-950">{paymentEstimate.label}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">{paymentEstimate.detail}</p>
        </div>

        <details className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-semibold text-zinc-950">
            更多服务
            <ChevronRight className="h-4 w-4 text-zinc-400" />
          </summary>
          <div className="border-t border-zinc-100 p-3">
            <button
              type="button"
              onClick={() => onOpenPayment?.(lot)}
              className="mb-2 inline-flex h-10 w-full items-center justify-center rounded-full border border-zinc-900 bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
            >
              <WalletCards className="mr-2 h-4 w-4" />
              模拟缴费与费用预估
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onToggleSaved?.(lot)}
                className={`inline-flex h-10 items-center justify-center rounded-full border px-3 text-xs font-semibold transition ${
                  isSaved
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                <Bookmark className={`mr-1.5 h-4 w-4 ${isSaved ? 'fill-emerald-600 text-emerald-600' : ''}`} />
                {isSaved ? '已收藏' : '稍后看'}
              </button>
              <button
                type="button"
                onClick={() => onToggleCompare?.(lot)}
                className={`inline-flex h-10 items-center justify-center rounded-full border px-3 text-xs font-semibold transition ${
                  isCompared
                    ? 'border-sky-200 bg-sky-50 text-sky-800'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                <Layers className="mr-1.5 h-4 w-4" />
                {isCompared ? '已对比' : '加入对比'}
              </button>
              <button
                type="button"
                onClick={() => onCopyLot?.(lot)}
                className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                <Clipboard className="mr-1.5 h-4 w-4" />
                复制信息
              </button>
              <button
                type="button"
                onClick={() => onReportDataIssue?.(lot)}
                className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                <Flag className="mr-1.5 h-4 w-4" />
                数据反馈
              </button>
            </div>
          </div>
        </details>

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
            打开完整服务详情
          </button>
        )}
      </div>
    </div>
  );
};

const LotRow = ({ lot, index, recommendedLot, selectedLot, onSelectLot }) => {
  const isRecommended = recommendedLot?.id === lot.id;
  const isSelected = selectedLot?.id === lot.id;
  const crowdStatus = getCrowdStatus(lot.stats.occupancy);
  const aiLabel = isRecommended
    ? 'AI首选'
    : lot.sourceType === 'ai_dataset_demo'
      ? '仅供验证'
      : !hasNavigableCoordinates(lot)
        ? '坐标待核验'
        : index <= 2
          ? 'AI备选'
          : 'AI候选';

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
      className={`group grid cursor-pointer gap-4 rounded-[24px] border px-4 py-4 outline-none transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-white hover:shadow-[0_18px_42px_rgba(15,23,42,0.07)] focus:border-emerald-300 lg:grid-cols-[minmax(0,1.45fr)_0.52fr_0.52fr_0.72fr_0.85fr] lg:items-center ${
        isSelected ? 'border-emerald-300 bg-white shadow-[0_18px_42px_rgba(16,185,129,0.12)]' : isRecommended ? 'border-emerald-200 bg-emerald-50/50' : 'border-zinc-100 bg-white'
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-base font-semibold text-zinc-950">{lot.name}</h2>
          {isRecommended && (
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-xs font-semibold text-emerald-700">
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              AI首选
            </span>
          )}
          {!isRecommended && (
            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-semibold text-zinc-600">
              {aiLabel}
            </span>
          )}
          {isSelected && (
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              已选
            </span>
          )}
          <ServiceBadge lot={lot} />
          <AiSignalBadge lot={lot} compact />
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

      <div className="grid grid-cols-3 gap-2 lg:contents">
        <div className="rounded-xl bg-zinc-50 px-3 py-2 lg:bg-transparent lg:px-0 lg:py-0">
          <p className="text-xl font-semibold leading-none text-zinc-950">{formatDistance(lot.distanceKm)}</p>
          <p className="mt-1 text-xs text-zinc-500">距离</p>
        </div>

        <div className="rounded-xl bg-emerald-50 px-3 py-2 lg:bg-transparent lg:px-0 lg:py-0">
          <p className="text-3xl font-semibold leading-none text-emerald-700 lg:text-2xl">{lot.stats.available}</p>
          <p className="mt-1 text-xs text-zinc-500">余位 / {lot.stats.total}</p>
        </div>

        <div className="rounded-xl bg-zinc-50 px-3 py-2 lg:hidden">
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
        <NavigationButton lot={lot} label="AI导航" className="ml-2 hidden h-9 px-3 text-xs sm:inline-flex" />
      </div>
    </motion.article>
  );
};

const ParkingLotDetailDrawer = ({
  lot,
  recommendedLot,
  isOpen,
  onClose,
  isSaved = false,
  isCompared = false,
  onToggleSaved,
  onToggleCompare,
  onCopyLot,
  onReportDataIssue,
  onOpenPayment,
  onCreateArrivalIntent,
  creatingArrivalIntent = false,
  paymentHours = 2
}) => {
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
  const readiness = getServiceReadiness(lot);
  const assurance = getArrivalAssurance(lot);
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
	                    <p className="text-xs font-semibold text-zinc-500">停车场详情</p>
	                    {isRecommended && (
	                      <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
	                        AI首选
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

              <div className="mt-4 grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-2">
                <NavigationButton lot={lot} label="AI导航" className="h-11 px-4 text-sm" />
                <button
                  type="button"
                  disabled={creatingArrivalIntent}
                  onClick={() => onCreateArrivalIntent?.(lot)}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ShieldCheck className="mr-1.5 h-4 w-4" />
                  {creatingArrivalIntent ? '生成中' : 'AI到场码'}
                </button>
              </div>

	              <div className={`mt-4 rounded-lg border px-3 py-2 text-sm font-semibold ${readiness.className}`}>
	                {readiness.label} · {readiness.detail}
	              </div>

	              <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
	                <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
	                  <p className="text-xl font-semibold leading-none">{lot.stats.available}</p>
	                  <p className="mt-1 text-xs">剩余</p>
	                </div>
	                <div className="rounded-lg bg-zinc-50 px-3 py-2 text-zinc-800">
	                  <p className="text-xl font-semibold leading-none">{formatDistance(lot.distanceKm)}</p>
	                  <p className="mt-1 text-xs">距离</p>
	                </div>
	                <div className="rounded-lg bg-emerald-50/70 px-3 py-2 text-emerald-800">
	                  <p className="text-xl font-semibold leading-none">{assurance?.probability ?? '--'}%</p>
	                  <p className="mt-1 text-xs">可停</p>
	                </div>
	                <div className={`rounded-lg px-3 py-2 ${crowdStatus.className}`}>
	                  <p className="text-sm font-semibold leading-none">{crowdStatus.label}</p>
	                  <p className="mt-1 text-xs">{lot.stats.occupancy}% 占用</p>
                </div>
              </div>
              <NavigationLinks lot={lot} className="mt-4" onOpenPayment={onOpenPayment} />
              <details className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-semibold text-zinc-950">
                  更多服务
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                </summary>
                <div className="grid grid-cols-2 gap-2 border-t border-zinc-100 p-3">
                  <button
                    type="button"
                    onClick={() => onToggleSaved?.(lot)}
                    className={`inline-flex h-10 items-center justify-center rounded-full border px-3 text-xs font-semibold transition ${
                      isSaved
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                    }`}
                  >
                    <Bookmark className={`mr-1.5 h-4 w-4 ${isSaved ? 'fill-emerald-600 text-emerald-600' : ''}`} />
                    {isSaved ? '已收藏' : '稍后看'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleCompare?.(lot)}
                    className={`inline-flex h-10 items-center justify-center rounded-full border px-3 text-xs font-semibold transition ${
                      isCompared
                        ? 'border-sky-200 bg-sky-50 text-sky-800'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                    }`}
                  >
                    <Layers className="mr-1.5 h-4 w-4" />
                    {isCompared ? '已对比' : '加入对比'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onCopyLot?.(lot)}
                    className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                  >
                    <Clipboard className="mr-1.5 h-4 w-4" />
                    复制信息
                  </button>
                  <button
                    type="button"
                    onClick={() => onReportDataIssue?.(lot)}
                    className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                  >
                    <Flag className="mr-1.5 h-4 w-4" />
                    数据反馈
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenPayment?.(lot)}
                    className="col-span-2 inline-flex h-10 items-center justify-center rounded-full border border-zinc-900 bg-zinc-950 px-3 text-xs font-semibold text-white transition hover:bg-zinc-800"
                  >
                    <WalletCards className="mr-1.5 h-4 w-4" />
                    模拟缴费与费用预估
                  </button>
                </div>
              </details>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <SelectedLotPanel
                lot={lot}
                recommendedLot={recommendedLot}
                className="border-0 p-0 shadow-none"
                showActionArea={false}
              />

              <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm font-semibold text-zinc-950">服务说明</p>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  当前按剩余车位、参考距离、占用率、收费信息和数据来源展示，仅用于行前判断。
                </p>
              </div>

              <div className="mt-4">
                <ArrivalAssuranceCard
                  lot={lot}
                  alternatives={[]}
                  onCreateIntent={onCreateArrivalIntent}
                />
              </div>

              <div className="mt-4">
                <PaymentEstimateCard
                  lot={lot}
                  hours={paymentHours}
                  onOpenPayment={onOpenPayment}
                />
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

const mobileViews = [
  { id: 'map', label: '地图', icon: MapPin },
  { id: 'recommend', label: 'AI推荐', icon: Sparkles },
  { id: 'list', label: 'AI列表', icon: Layers },
  { id: 'mine', label: '我的', icon: Bookmark }
];

const MobileViewTabs = ({ activeView, onChange, arrivalIntentCount = 0 }) => (
  <div className="sticky top-[73px] z-10 -mx-4 border-y border-emerald-50 bg-[#f7faf7]/95 px-4 py-2 backdrop-blur lg:hidden">
    <div className="grid grid-cols-4 gap-1 rounded-full border border-emerald-100 bg-white/90 p-1 shadow-[0_10px_24px_rgba(16,185,129,0.08)]">
      {mobileViews.map((view) => {
        const Icon = view.icon;
        const isActive = activeView === view.id;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onChange(view.id)}
            className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-full text-xs font-semibold transition ${
              isActive ? 'bg-emerald-600 text-white shadow-[0_8px_18px_rgba(16,185,129,0.24)]' : 'text-zinc-600 hover:bg-emerald-50 hover:text-emerald-800'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {view.label}
            {view.id === 'mine' && arrivalIntentCount > 0 && (
              <span className={`ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] ${
                isActive ? 'bg-white text-zinc-950' : 'bg-emerald-100 text-emerald-700'
              }`}>
                {arrivalIntentCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  </div>
);

const MobileParkingActionBar = ({ lot, onOpenPayment, onCreateArrivalIntent, creatingArrivalIntent = false, onOpenMore }) => {
  if (!lot) {
    return null;
  }

  const aiSignal = getAiSignal(lot);

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 rounded-t-[26px] border-t border-emerald-100 bg-white/95 px-4 pb-3 pt-3 shadow-[0_-18px_42px_rgba(15,23,42,0.12)] backdrop-blur lg:hidden">
      <div className="mx-auto max-w-[1500px]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-zinc-950">{lot.name}</p>
            <ServiceBadge lot={lot} />
            <span className="inline-flex flex-none items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
              AI {aiSignal.score}%
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-zinc-500">
            {lot.stats.available} 个余位 · {formatDistance(lot.distanceKm)} · {lot.metadata.fee_rule || '收费待补充'}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)_auto] gap-2">
          <NavigationButton lot={lot} label="AI导航" className="h-12 rounded-full px-4 text-sm shadow-[0_12px_24px_rgba(16,185,129,0.20)]" />
          <button
            type="button"
            onClick={() => onCreateArrivalIntent?.(lot)}
            disabled={creatingArrivalIntent}
            className="inline-flex h-12 min-w-0 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 px-2.5 text-sm font-semibold text-emerald-800"
          >
            {creatingArrivalIntent ? '生成中' : 'AI到场码'}
          </button>
          <button
            type="button"
            onClick={onOpenMore}
            className="inline-flex h-12 flex-none items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700"
          >
            更多
          </button>
        </div>
      </div>
    </div>
  );
};

const MobileMoreActionsSheet = ({
  lot,
  isOpen,
  isSaved,
  isCompared,
  creatingArrivalIntent = false,
  onClose,
  onOpenDetails,
  onOpenPayment,
  onCreateArrivalIntent,
  onToggleSaved,
  onToggleCompare,
  onCopyLot,
  onReportDataIssue,
  onShowList
}) => {
  if (!lot) {
    return null;
  }

  const assurance = getArrivalAssurance(lot);
  const serviceReadiness = getServiceReadiness(lot);
  const utilityActions = [
    {
      label: isSaved ? '移出稍后看' : '加入稍后看',
      icon: Bookmark,
      onClick: () => onToggleSaved?.(lot)
    },
    {
      label: isCompared ? '移出对比' : '加入对比',
      icon: Layers,
      onClick: () => onToggleCompare?.(lot)
    },
    {
      label: '复制信息',
      icon: Clipboard,
      onClick: () => onCopyLot?.(lot)
    },
    {
      label: '数据待核验',
      icon: Flag,
      onClick: () => onReportDataIssue?.(lot)
    },
    {
      label: 'AI 换一个',
      icon: RefreshCw,
      onClick: () => onShowList?.()
    }
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className="fixed inset-0 z-40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.button
            type="button"
            aria-label="关闭更多操作"
            className="absolute inset-0 bg-zinc-950/35"
            onClick={onClose}
          />
          <motion.aside
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-zinc-200 bg-white p-4 shadow-2xl"
            initial={{ y: 32, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 32, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
          >
            <div className="mx-auto mb-3 h-1 w-11 rounded-full bg-zinc-300" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-500">AI 停车服务面板</p>
                <h2 className="mt-1 truncate text-lg font-semibold text-zinc-950">{lot.name}</h2>
                <p className="mt-1 text-xs text-zinc-500">{lot.stats.available} 个余位 · {formatDistance(lot.distanceKm)}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-md border border-zinc-200 text-zinc-500"
                aria-label="关闭更多操作"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-emerald-50 px-3 py-3 text-emerald-800">
                <p className="text-xl font-semibold leading-none">{lot.stats.available}</p>
                <p className="mt-1 text-[11px] font-medium">剩余车位</p>
              </div>
              <div className="rounded-xl bg-zinc-50 px-3 py-3 text-zinc-800">
                <p className="text-xl font-semibold leading-none">{assurance?.probability ?? '--'}%</p>
                <p className="mt-1 text-[11px] font-medium">可停概率</p>
              </div>
              <div className="rounded-xl bg-zinc-50 px-3 py-3 text-zinc-800">
                <p className="text-xl font-semibold leading-none">{formatDistance(lot.distanceKm)}</p>
                <p className="mt-1 text-[11px] font-medium">参考距离</p>
              </div>
            </div>

            <div className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold ${serviceReadiness.className}`}>
              {serviceReadiness.label} · {serviceReadiness.detail}
            </div>

            <div className="mt-4 grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-2">
              <NavigationButton lot={lot} label="AI导航" className="h-12 px-4 text-sm" />
              <button
                type="button"
                disabled={creatingArrivalIntent}
                onClick={() => {
                  onCreateArrivalIntent?.(lot);
                  onClose?.();
                }}
                className="inline-flex h-12 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ShieldCheck className="mr-1.5 h-4 w-4" />
                {creatingArrivalIntent ? '生成中' : 'AI到场码'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenPayment?.(lot);
                  onClose?.();
                }}
                className="col-span-2 inline-flex h-11 items-center justify-center rounded-lg border border-zinc-900 bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
              >
                <WalletCards className="mr-2 h-4 w-4" />
                模拟缴费与费用预估
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-100 pt-4">
              <p className="text-xs font-semibold text-zinc-500">本地工具</p>
              <button
                type="button"
                onClick={() => {
                  onOpenDetails?.(lot);
                  onClose?.();
                }}
                className="inline-flex items-center text-xs font-semibold text-zinc-950"
              >
                完整详情
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {utilityActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => {
                      action.onClick();
                      onClose?.();
                    }}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                  >
                    <Icon className="h-4 w-4 text-zinc-500" />
                    {action.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              导航会跳转外部地图；到场码和模拟缴费均为演示流程，不锁位、不扣款。收藏、最近查看和对比只保存在本机浏览器。
            </p>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const ParkingToast = ({ message }) => (
  <AnimatePresence>
    {message && (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        className="fixed bottom-32 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-medium text-white shadow-2xl lg:bottom-8"
      >
        {message}
      </motion.div>
    )}
  </AnimatePresence>
);

const PaymentSimulationDrawer = ({
  lot,
  isOpen,
  hours,
  receipt,
  onChangeHours,
  onClose,
  onConfirm,
  onCopyReceipt
}) => {
  if (!lot) {
    return null;
  }

  const estimate = getPaymentEstimate(lot, hours);
  const durations = [1, 2, 4, 8];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.button
            type="button"
            aria-label="关闭模拟缴费"
            className="absolute inset-0 bg-zinc-950/35"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={`${lot.name} 模拟缴费`}
            className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-2xl border-t border-zinc-200 bg-white shadow-2xl lg:left-auto lg:right-6 lg:top-24 lg:w-[420px] lg:rounded-2xl lg:border"
            initial={{ y: 36, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 36, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
          >
            <div className="border-b border-zinc-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-zinc-500">收费预估 · 模拟缴费</p>
                  <h2 className="mt-2 text-xl font-semibold leading-tight text-zinc-950">{lot.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">{lot.metadata.fee_rule || '暂无收费标准'}</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950"
                  aria-label="关闭模拟缴费"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-5">
              {receipt ? (
                <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-emerald-600 text-white">
                      <Check className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-emerald-950">模拟缴费凭证已生成</p>
                      <p className="mt-1 break-all text-xs leading-5 text-emerald-800">{receipt.id}</p>
                      <p className="mt-1 text-xs text-emerald-700">{receipt.createdAt} · {receipt.amountLabel}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onCopyReceipt?.(receipt, 'id')}
                      className="inline-flex h-9 items-center justify-center rounded-md border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
                    >
                      <Clipboard className="mr-1.5 h-3.5 w-3.5" />
                      复制凭证号
                    </button>
                    <button
                      type="button"
                      onClick={() => onCopyReceipt?.(receipt, 'full')}
                      className="inline-flex h-9 items-center justify-center rounded-md border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
                    >
                      复制缴费信息
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl bg-zinc-950 p-4 text-white">
                <p className="text-xs text-zinc-400">预计停车 {hours} 小时</p>
                <p className="mt-2 text-4xl font-semibold">{estimate.label}</p>
                <p className="mt-3 text-sm leading-6 text-zinc-300">{estimate.detail}</p>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2">
                {durations.map((duration) => (
                  <button
                    key={duration}
                    type="button"
                    onClick={() => onChangeHours(duration)}
                    className={`h-10 rounded-md border text-sm font-semibold transition ${
                      duration === hours
                        ? 'border-zinc-950 bg-zinc-950 text-white'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                    }`}
                  >
                    {duration} 小时
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                当前只做演示支付流，不连接真实微信/支付宝，不创建真实订单，不发生扣款、退款或对账。
              </div>

              <button
                type="button"
                onClick={() => onConfirm?.(lot, estimate)}
                className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                <WalletCards className="mr-2 h-4 w-4" />
                生成模拟缴费凭证
              </button>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const ArrivalIntentDrawer = ({ intent, isOpen, onClose, onCopy }) => {
  if (!intent) {
    return null;
  }

  const snapshot = intent.lot_snapshot || {};
  const currentAssurance = intent.current_assurance || null;
  const snapshotDelta = intent.snapshot_delta || null;
  const switchRecommendation = intent.switch_recommendation || null;
  const alternatives = intent.alternatives || [];
  const timing = getArrivalIntentTiming(intent);
  const guard = getArrivalIntentGuard(intent);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.button
            type="button"
            aria-label="关闭到场计划"
            className="absolute inset-0 bg-zinc-950/35"
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="到场计划"
            className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-2xl border-t border-zinc-200 bg-white shadow-2xl lg:left-auto lg:right-6 lg:top-24 lg:w-[430px] lg:rounded-2xl lg:border"
            initial={{ y: 36, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 36, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
          >
            <div className="border-b border-zinc-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-zinc-500">到场计划 · 演示凭证</p>
                  <h2 className="mt-2 text-xl font-semibold text-zinc-950">{snapshot.name || '停车场'}</h2>
                  <p className="mt-2 text-sm text-zinc-600">预计 {intent.estimated_arrival_minutes} 分钟到达，停留约 {intent.expected_duration_minutes} 分钟。</p>
                </div>
                <button type="button" onClick={onClose} className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-md border border-zinc-200 text-zinc-500" aria-label="关闭到场计划">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                  <span>出发进度</span>
                  <span>
                    {timing.etaRemainingMinutes === null
                      ? '预计到达待计算'
                      : timing.etaRemainingMinutes > 0
                        ? `约 ${timing.etaRemainingMinutes} 分钟后到达`
                        : '已到达预计时间'}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div className={`h-full rounded-full transition-all ${guard.barClassName}`} style={{ width: `${timing.progress}%` }} />
                </div>
              </div>
            </div>
            <div className="p-5">
              <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5 text-white">
                <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">Arrival Code</p>
                <p className="mt-3 break-all text-3xl font-semibold">{intent.display_code}</p>
                <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-zinc-400">可停概率</p>
                    <p className="mt-1 font-semibold">{snapshot.probability ?? '--'}%</p>
                  </div>
                  <div>
                    <p className="text-zinc-400">余位</p>
                    <p className="mt-1 font-semibold">{snapshot.available_slots ?? '--'}</p>
                  </div>
                  <div>
                    <p className="text-zinc-400">风险</p>
                    <p className="mt-1 font-semibold">{snapshot.risk?.label || '待判断'}</p>
                  </div>
                </div>
              </div>
              <div className={`mt-4 rounded-xl border p-4 ${guard.className}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">到场守护</p>
                    <p className="mt-1 text-xs leading-5">
                      {guard.description}
                    </p>
                  </div>
                  <span className="rounded-md border border-current/20 bg-white/60 px-2 py-1 text-xs font-semibold">
                    {guard.label}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-white/70 p-2">
                    <p className="text-zinc-500">当前可停</p>
                    <p className="mt-1 text-base font-semibold text-zinc-950">{currentAssurance?.probability ?? '--'}%</p>
                  </div>
                  <div className="rounded-lg bg-white/70 p-2">
                    <p className="text-zinc-500">余位变化</p>
                    <p className="mt-1 text-base font-semibold text-zinc-950">
                      {snapshotDelta ? `${snapshotDelta.available_slots_delta >= 0 ? '+' : ''}${snapshotDelta.available_slots_delta}` : '--'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white/70 p-2">
                    <p className="text-zinc-500">当前余位</p>
                    <p className="mt-1 text-base font-semibold text-zinc-950">{currentAssurance?.available_slots ?? '--'}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-white/70 p-2">
                    <p className="text-zinc-500">剩余有效期</p>
                    <p className="mt-1 font-semibold text-zinc-950">
                      {timing.remainingMinutes === null ? '待计算' : `${timing.remainingMinutes} 分钟`}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white/70 p-2">
                    <p className="text-zinc-500">当前决策</p>
                    <p className="mt-1 font-semibold text-zinc-950">
                      {currentAssurance ? getDecisionLabel(currentAssurance.decision_status) : '待同步'}
                    </p>
                  </div>
                </div>
              </div>
              {alternatives.length > 0 && (
                <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-sm font-semibold text-zinc-950">Plan B / Plan C</p>
                  {switchRecommendation?.should_switch && switchRecommendation.suggested_lot && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                      <span className="font-semibold">建议切换：</span>
                      {switchRecommendation.suggested_lot.name} 当前更稳，可停 {switchRecommendation.suggested_lot.probability ?? '--'}%。
                    </div>
                  )}
                  <div className="mt-3 space-y-2">
                    {alternatives.slice(0, 2).map((candidate, index) => (
                      <div key={candidate.id} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                        <p className="text-xs font-semibold text-zinc-500">Plan {index === 0 ? 'B' : 'C'} · 可停 {candidate.probability ?? '--'}%</p>
                        <p className="mt-1 truncate text-sm font-semibold text-zinc-950">{candidate.name}</p>
                        <p className="mt-1 text-xs text-zinc-500">{candidate.available_slots ?? '--'} 余位 · {formatDistance(candidate.distance_km ?? null)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                {intent.disclaimer || '该到场计划仅用于演示，不锁位、不扣款、不代表真实预约。'}
              </div>
              <p className="mt-3 text-xs text-zinc-500">有效期至：{new Date(intent.expires_at).toLocaleString('zh-CN', { hour12: false })}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <NavigationButton lot={snapshot} label="继续导航" className="h-11 px-3 text-sm" />
                <button
                  type="button"
                  onClick={() => onCopy?.(intent)}
                  className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                >
                  <Clipboard className="mr-2 h-4 w-4" />
                  复制计划
                </button>
              </div>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const ArrivalPlanList = ({
  records,
  loading,
  onOpen,
  onCopy,
  onRemove
}) => (
  <section className="rounded-[28px] border border-emerald-100 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.055)]">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-zinc-950">我的到场计划</p>
        <p className="mt-1 text-xs text-zinc-500">出发中守护卡，仅保存在本机</p>
      </div>
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
        <ShieldCheck className="h-4 w-4" />
      </span>
    </div>

    <div className="mt-4 space-y-2">
      {loading ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 px-3 py-4 text-sm text-zinc-500">
          正在同步本机到场码...
        </div>
      ) : records.length > 0 ? records.map((intent) => {
        const snapshot = intent.lot_snapshot || {};
        const currentAssurance = intent.current_assurance || null;
        const delta = intent.snapshot_delta || null;
        const switchRecommendation = intent.switch_recommendation || null;
        const timing = getArrivalIntentTiming(intent);
        const guard = getArrivalIntentGuard(intent);
        return (
          <div key={intent.display_code} className={`overflow-hidden rounded-[24px] border bg-white shadow-[0_10px_24px_rgba(15,23,42,0.04)] ${guard.className}`}>
            <div className="flex items-center justify-between gap-3 border-b border-current/10 bg-white/65 px-3 py-2">
              <span className="text-xs font-semibold">出发中守护</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                timing.expired
                  ? 'border-zinc-200 bg-white text-zinc-500'
                  : switchRecommendation?.should_switch
                    ? 'border-amber-200 bg-white text-amber-700'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}>
                {guard.label}
              </span>
            </div>
            <div className="p-3">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => onOpen?.(intent)}
                className="min-w-0 text-left"
              >
                <p className="truncate text-sm font-semibold text-zinc-950">{snapshot.name || '停车场'}</p>
                <p className="mt-1 break-all text-xs font-semibold text-emerald-700">{intent.display_code}</p>
              </button>
              <NavigationButton lot={snapshot} label="导航" className="h-9 flex-none rounded-full px-3 text-xs" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-xl bg-white/70 p-2">
                <p className="text-zinc-500">当前余位</p>
                <p className="mt-1 text-base font-semibold text-zinc-950">{currentAssurance?.available_slots ?? snapshot.available_slots ?? '--'}</p>
              </div>
              <div className="rounded-xl bg-white/70 p-2">
                <p className="text-zinc-500">可停概率</p>
                <p className="mt-1 text-base font-semibold text-zinc-950">{currentAssurance?.probability ?? snapshot.probability ?? '--'}%</p>
              </div>
              <div className="rounded-xl bg-white/70 p-2">
                <p className="text-zinc-500">余位变化</p>
                <p className="mt-1 text-base font-semibold text-zinc-950">
                  {delta ? `${delta.available_slots_delta >= 0 ? '+' : ''}${delta.available_slots_delta}` : '--'}
                </p>
              </div>
            </div>
            {switchRecommendation?.should_switch && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                建议切换 Plan B：当前车场风险升高，出发前建议查看备选。
              </div>
            )}
            <div className="mt-3">
              <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                <span>{timing.etaRemainingMinutes > 0 ? `约 ${timing.etaRemainingMinutes} 分钟到达` : '已到预计到达时间'}</span>
                <span>{timing.remainingMinutes === null ? '有效期待计算' : `${timing.remainingMinutes} 分钟后过期`}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/70">
                <div className={`h-full rounded-full ${guard.barClassName}`} style={{ width: `${timing.progress}%` }} />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onCopy?.(intent)}
                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                <Clipboard className="mr-1.5 h-3.5 w-3.5" />
                复制
              </button>
              <button
                type="button"
                onClick={() => onRemove?.(intent.display_code)}
                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                移除本机记录
              </button>
            </div>
            </div>
          </div>
        );
      }) : (
        <div className="rounded-2xl border border-dashed border-zinc-200 px-3 py-4 text-sm leading-6 text-zinc-500">
          还没有到场计划。点击推荐车场的“到场码”后，会在这里保存本机记录。
        </div>
      )}
    </div>
  </section>
);

const ActiveGuardianStrip = ({ intent, onOpen, onShowMine }) => {
  if (!intent) {
    return null;
  }

  const snapshot = intent.lot_snapshot || {};
  const currentAssurance = intent.current_assurance || null;
  const delta = intent.snapshot_delta || null;
  const guard = getArrivalIntentGuard(intent);
  const timing = getArrivalIntentTiming(intent);

  return (
    <section className={`overflow-hidden rounded-xl border shadow-sm ${guard.className}`}>
      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_240px] md:items-center">
        <button type="button" onClick={() => onOpen?.(intent)} className="min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-current/20 bg-white/60 px-2 py-1 text-xs font-semibold">
              {guard.label}
            </span>
            <span className="text-xs text-zinc-500">到场码 {intent.display_code}</span>
          </div>
          <h2 className="mt-2 truncate text-lg font-semibold text-zinc-950">{snapshot.name || '停车场'}</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            {guard.description}
          </p>
        </button>

        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-white/70 p-2">
            <p className="text-zinc-500">可停</p>
            <p className="mt-1 text-base font-semibold text-zinc-950">{currentAssurance?.probability ?? snapshot.probability ?? '--'}%</p>
          </div>
          <div className="rounded-lg bg-white/70 p-2">
            <p className="text-zinc-500">余位</p>
            <p className="mt-1 text-base font-semibold text-zinc-950">{currentAssurance?.available_slots ?? snapshot.available_slots ?? '--'}</p>
          </div>
          <div className="rounded-lg bg-white/70 p-2">
            <p className="text-zinc-500">变化</p>
            <p className="mt-1 text-base font-semibold text-zinc-950">
              {delta ? `${delta.available_slots_delta >= 0 ? '+' : ''}${delta.available_slots_delta}` : '--'}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-current/10 bg-white/50 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3 text-[11px] text-zinc-500">
              <span>{timing.etaRemainingMinutes > 0 ? `约 ${timing.etaRemainingMinutes} 分钟到达` : '已到预计到达时间'}</span>
              <span>{timing.remainingMinutes === null ? '有效期待计算' : `${timing.remainingMinutes} 分钟后过期`}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-200/70">
              <div className={`h-full rounded-full ${guard.barClassName}`} style={{ width: `${timing.progress}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <NavigationButton lot={snapshot} label="继续导航" className="h-9 px-3 text-xs" />
            <button
              type="button"
              onClick={() => onShowMine?.()}
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-50"
            >
              我的计划
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

const ParkGovAgentLauncher = ({ onOpen, hasSelectedLot }) => (
  <button
    type="button"
    onClick={onOpen}
    className="fixed bottom-32 right-3 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-emerald-100 bg-white p-0 text-sm font-semibold text-emerald-800 shadow-[0_16px_36px_rgba(15,23,42,0.16)] transition hover:-translate-y-0.5 hover:bg-emerald-50 sm:right-4 lg:bottom-6 lg:right-6 lg:h-auto lg:w-auto lg:gap-2 lg:px-4 lg:py-3"
  >
    <span className="absolute -left-2 -top-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold leading-none text-emerald-800 shadow-sm lg:hidden">
      AI
    </span>
    <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 lg:hidden">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
    </span>
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white">
      <Bot className="h-4 w-4" />
    </span>
    <span className="hidden lg:inline">{hasSelectedLot ? '问 AI 为什么' : 'ParkGov Agent'}</span>
    <span className="sr-only">{hasSelectedLot ? '打开当前停车场智能助手' : '打开 ParkGov 智能体助手'}</span>
  </button>
);

const LocalServiceTools = ({
  savedLots,
  recentLots,
  compareLots,
  onOpenLot,
  onToggleCompare,
  onCopyLot
}) => (
  <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-zinc-950">我的停车工具</p>
        <p className="mt-1 text-xs text-zinc-500">本地保存，不上传个人信息</p>
      </div>
      <Bookmark className="h-4 w-4 text-zinc-400" />
    </div>

    <div className="mt-4 grid gap-3">
      <div>
        <p className="text-xs font-semibold text-zinc-500">稍后看</p>
        <div className="mt-2 space-y-2">
          {savedLots.length > 0 ? savedLots.slice(0, 3).map((lot) => (
            <button
              key={lot.id}
              type="button"
              onClick={() => onOpenLot?.(lot)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-left text-xs transition hover:bg-zinc-50"
            >
              <span className="min-w-0 truncate font-semibold text-zinc-900">{lot.name}</span>
              <span className="flex-none text-emerald-700">{lot.stats.available} 位</span>
            </button>
          )) : (
            <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-500">还没有收藏停车场</p>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-zinc-500">最近查看</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {recentLots.length > 0 ? recentLots.slice(0, 4).map((lot) => (
            <button
              key={lot.id}
              type="button"
              onClick={() => onOpenLot?.(lot)}
              className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-white"
            >
              {lot.name}
            </button>
          )) : (
            <span className="text-xs text-zinc-500">暂无最近查看</span>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-zinc-500">对比车场</p>
        <div className="mt-2 space-y-2">
          {compareLots.length > 0 ? compareLots.map((lot) => (
            <div key={lot.id} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs">
              <button type="button" onClick={() => onOpenLot?.(lot)} className="min-w-0 truncate text-left font-semibold text-zinc-900">
                {lot.name}
              </button>
              <span className="flex-none text-zinc-500">{formatDistance(lot.distanceKm)} · {lot.stats.available} 位</span>
            </div>
          )) : (
            <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-500">在详情中加入对比</p>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => compareLots[0] && onCopyLot?.(compareLots[0])}
            disabled={compareLots.length === 0}
            className="h-9 rounded-md border border-zinc-200 px-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            复制信息
          </button>
          <button
            type="button"
            onClick={() => compareLots[0] && onToggleCompare?.(compareLots[0])}
            disabled={compareLots.length === 0}
            className="h-9 rounded-md border border-zinc-200 px-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            移出对比
          </button>
        </div>
      </div>
    </div>
  </section>
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
          后端服务正在唤醒，暂不能展示实时余位
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-600">
          ParkGov AI 线上展示连接 Render 后端和 Neon PostgreSQL。Render 免费实例长时间无人访问后会休眠，首次打开可能需要 30-60 秒唤醒；当前不会使用静态假数据冒充余位，稍等后点击“重新连接”即可。
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
            Render 免费后端可能冷启动；如果刚打开页面显示未连接，等待半分钟后刷新或点“重新连接”。
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
  const [arrivalRecommendations, setArrivalRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortMode, setSortMode] = useState('recommended');
  const [selectedLotId, setSelectedLotId] = useState('');
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isMoreActionsOpen, setIsMoreActionsOpen] = useState(false);
  const [isAiAdjustOpen, setIsAiAdjustOpen] = useState(false);
  const [mobileView, setMobileView] = useState('map');
  const [paymentLotId, setPaymentLotId] = useState('');
  const [paymentHours, setPaymentHours] = useState(2);
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  const [arrivalIntent, setArrivalIntent] = useState(null);
  const [isArrivalIntentOpen, setIsArrivalIntentOpen] = useState(false);
  const [creatingArrivalIntent, setCreatingArrivalIntent] = useState(false);
  const [arrivalIntentCodes, setArrivalIntentCodes] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('parkgov_arrival_intent_codes') || '[]');
    } catch {
      return [];
    }
  });
  const [arrivalIntentRecords, setArrivalIntentRecords] = useState([]);
  const [loadingArrivalIntentRecords, setLoadingArrivalIntentRecords] = useState(false);
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [savedLotIds, setSavedLotIds] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('parkgov_saved_lots') || '[]');
    } catch {
      return [];
    }
  });
  const [recentLotIds, setRecentLotIds] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('parkgov_recent_lots') || '[]');
    } catch {
      return [];
    }
  });
  const [compareLotIds, setCompareLotIds] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('parkgov_compare_lots') || '[]');
    } catch {
      return [];
    }
  });
  const [toastMessage, setToastMessage] = useState('');
  const toastTimerRef = useRef(null);

  const loadParkingLots = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const response = await withParkingRequestTimeout(parkingService.getAllParkingLots(), '停车场余位', 65000);
      const lots = response.data?.data?.parking_lots || [];
      setParkingLots(lots);
      setLoading(false);
      setRefreshing(false);

      withParkingRequestTimeout(parkingService.getRecommendations({ limit: 50 }), '到场保障推荐', 12000)
        .then((recommendationsResponse) => {
          setArrivalRecommendations(recommendationsResponse.data?.data?.recommendations || []);
        })
        .catch((recommendationsError) => {
          setArrivalRecommendations([]);
          console.warn('Arrival recommendations unavailable, using frontend fallback.', recommendationsError);
        });
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

  useEffect(() => {
    window.localStorage.setItem('parkgov_saved_lots', JSON.stringify(savedLotIds));
  }, [savedLotIds]);

  useEffect(() => {
    window.localStorage.setItem('parkgov_recent_lots', JSON.stringify(recentLotIds));
  }, [recentLotIds]);

  useEffect(() => {
    window.localStorage.setItem('parkgov_compare_lots', JSON.stringify(compareLotIds));
  }, [compareLotIds]);

  useEffect(() => {
    window.localStorage.setItem('parkgov_arrival_intent_codes', JSON.stringify(arrivalIntentCodes));
  }, [arrivalIntentCodes]);

  useEffect(() => {
    let cancelled = false;

    const loadArrivalIntentRecords = async () => {
      const codes = arrivalIntentCodes.filter(Boolean).slice(0, 8);
      if (codes.length === 0) {
        setArrivalIntentRecords([]);
        return;
      }

      setLoadingArrivalIntentRecords(true);
      try {
        const results = await Promise.allSettled(
          codes.map((code) => parkingService.getArrivalIntent(code))
        );

        if (cancelled) {
          return;
        }

        setArrivalIntentRecords(results
          .filter((result) => result.status === 'fulfilled')
          .map((result) => result.value.data?.data)
          .filter(Boolean));
      } finally {
        if (!cancelled) {
          setLoadingArrivalIntentRecords(false);
        }
      }
    };

    loadArrivalIntentRecords();

    return () => {
      cancelled = true;
    };
  }, [arrivalIntentCodes]);

  const recommendationMap = useMemo(() => new Map(
    arrivalRecommendations.map((recommendation) => [String(recommendation.id || recommendation.parking_lot_id), recommendation])
  ), [arrivalRecommendations]);

  const enrichedLots = useMemo(() => (
    parkingLots.map((lot) => enrichLot(lot, recommendationMap))
  ), [parkingLots, recommendationMap]);

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
        const firstProbability = getArrivalAssurance(first)?.probability || 0;
        const secondProbability = getArrivalAssurance(second)?.probability || 0;
        return secondProbability - firstProbability || second.recommendationScore - first.recommendationScore || firstDistance - secondDistance;
      });
  }, [enrichedLots, query, sourceFilter, sortMode]);

  const recommendedLot = filteredLots[0] || null;
  const selectedLot = filteredLots.find((lot) => String(lot.id) === String(selectedLotId)) || recommendedLot;
  const paymentLot = filteredLots.find((lot) => String(lot.id) === String(paymentLotId)) || selectedLot;
  const savedLots = useMemo(() => savedLotIds
    .map((id) => enrichedLots.find((lot) => String(lot.id) === String(id)))
    .filter(Boolean), [enrichedLots, savedLotIds]);
  const recentLots = useMemo(() => recentLotIds
    .map((id) => enrichedLots.find((lot) => String(lot.id) === String(id)))
    .filter(Boolean), [enrichedLots, recentLotIds]);
  const compareLots = useMemo(() => compareLotIds
    .map((id) => enrichedLots.find((lot) => String(lot.id) === String(id)))
    .filter(Boolean), [compareLotIds, enrichedLots]);
  const nearestLot = useMemo(() => (
    filteredLots.filter((lot) => lot.distanceKm !== null).sort((first, second) => first.distanceKm - second.distanceKm)[0] || null
  ), [filteredLots]);
  const mostAvailableLot = useMemo(() => (
    [...filteredLots].sort((first, second) => second.stats.available - first.stats.available)[0] || null
  ), [filteredLots]);
  const comfortableLot = useMemo(() => (
    [...filteredLots].sort((first, second) => first.stats.occupancy - second.stats.occupancy)[0] || null
  ), [filteredLots]);
  const assuranceAlternatives = useMemo(() => (
    getAlternativeLots(filteredLots, recommendedLot, 4)
  ), [filteredLots, recommendedLot]);
  const selectedAlternatives = useMemo(() => (
    getAlternativeLots(filteredLots, selectedLot, 4)
  ), [filteredLots, selectedLot]);
  const nearestAlternativeLot = useMemo(() => (
    filteredLots
      .filter((lot) => recommendedLot && String(lot.id) !== String(recommendedLot.id) && lot.distanceKm !== null)
      .sort((first, second) => first.distanceKm - second.distanceKm || (getArrivalAssurance(second)?.probability || 0) - (getArrivalAssurance(first)?.probability || 0))[0]
    || assuranceAlternatives[1]
    || assuranceAlternatives[0]
    || null
  ), [assuranceAlternatives, filteredLots, recommendedLot]);
  const latestArrivalIntentRecord = arrivalIntentRecords[0] || null;
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
      arrivalProbability: getArrivalAssurance(recommendedLot)?.probability,
      arrivalRisk: getArrivalAssurance(recommendedLot)?.risk?.label,
      arrivalEtaMinutes: getArrivalAssurance(recommendedLot)?.eta_minutes,
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
      arrivalProbability: getArrivalAssurance(selectedLot)?.probability,
      arrivalRisk: getArrivalAssurance(selectedLot)?.risk?.label,
      arrivalEtaMinutes: getArrivalAssurance(selectedLot)?.eta_minutes,
      breakdown: getRecommendationBreakdown(selectedLot),
      navigationAvailable: hasNavigableCoordinates(selectedLot)
    } : null,
	    nearestLot: nearestLot ? {
	      name: nearestLot.name,
	      available: nearestLot.stats.available,
	      total: nearestLot.stats.total,
	      occupancy: nearestLot.stats.occupancy,
	      distance: formatDistance(nearestLot.distanceKm)
	    } : null,
	    alternatives: assuranceAlternatives.map((lot, index) => ({
	      rank: index === 0 ? 'Plan B' : 'Plan C',
	      name: lot.name,
	      available: lot.stats.available,
	      total: lot.stats.total,
	      occupancy: lot.stats.occupancy,
	      distance: formatDistance(lot.distanceKm),
	      arrivalProbability: getArrivalAssurance(lot)?.probability,
	      arrivalRisk: getArrivalAssurance(lot)?.risk?.label
	    })),
	    activeArrivalIntent: latestArrivalIntentRecord ? {
      code: latestArrivalIntentRecord.display_code,
      status: latestArrivalIntentRecord.status,
      lotName: latestArrivalIntentRecord.parking_lot_name,
      currentProbability: latestArrivalIntentRecord.current_assurance?.probability,
      currentRisk: latestArrivalIntentRecord.current_assurance?.risk?.label,
      availableDelta: latestArrivalIntentRecord.snapshot_delta?.available_slots_delta,
      shouldSwitch: latestArrivalIntentRecord.switch_recommendation?.should_switch,
      suggestedLot: latestArrivalIntentRecord.switch_recommendation?.suggested_lot?.name
    } : null
	  }), [assuranceAlternatives, averageOccupancy, latestArrivalIntentRecord, nearestLot, recommendedLot, selectedLot, summary]);

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
    setRecentLotIds((currentIds) => [String(lot.id), ...currentIds.filter((id) => id !== String(lot.id))].slice(0, 6));
    setIsDetailOpen(true);
  };

  const openPayment = (lot) => {
    if (!lot) {
      return;
    }
    setSelectedLotId(String(lot.id));
    setPaymentLotId(String(lot.id));
    setPaymentReceipt(null);
    setIsPaymentOpen(true);
  };

  const showToast = (message) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(''), 2200);
  };

  const toggleSavedLot = (lot) => {
    if (!lot) {
      return;
    }

    const lotId = String(lot.id);
    const alreadySaved = savedLotIds.includes(lotId);
    setSavedLotIds((currentIds) => (
      alreadySaved ? currentIds.filter((id) => id !== lotId) : [...currentIds, lotId]
    ));
    showToast(alreadySaved ? '已从稍后看移除' : '已加入稍后看');
  };

  const toggleCompareLot = (lot) => {
    if (!lot) {
      return;
    }

    const lotId = String(lot.id);
    const alreadyCompared = compareLotIds.includes(lotId);
    setCompareLotIds((currentIds) => (
      alreadyCompared
        ? currentIds.filter((id) => id !== lotId)
        : [lotId, ...currentIds.filter((id) => id !== lotId)].slice(0, 3)
    ));
    showToast(alreadyCompared ? '已移出对比' : '已加入对比');
  };

  const copyLotInfo = async (lot) => {
    const copied = await copyToClipboard(getParkingInfoText(lot));
    showToast(copied ? '停车场信息已复制' : '复制失败，请稍后再试');
  };

  const reportDataIssue = (lot) => {
    showToast(`${lot?.name || '该停车场'} 已标记为待核验，本轮先记录在前端演示态。`);
  };

  const showMobileList = () => {
    setMobileView('list');
    window.setTimeout(() => {
      document.getElementById('parking-lot-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const showMapView = () => {
    setMobileView('map');
    window.setTimeout(() => {
      document.getElementById('parking-map-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const showMineView = () => {
    setMobileView('mine');
    window.setTimeout(() => {
      document.getElementById('parking-mine')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const confirmPaymentSimulation = (lot, estimate) => {
    const receipt = createPaymentReceipt(lot, estimate, paymentHours);
    setPaymentReceipt(receipt);
    showToast(`${lot?.name || '停车场'} 已生成模拟缴费凭证。`);
  };

  const copyPaymentReceipt = async (receipt, mode = 'id') => {
    const copied = await copyToClipboard(mode === 'full' ? getPaymentReceiptText(receipt) : receipt?.id || '');
    showToast(copied ? (mode === 'full' ? '模拟缴费信息已复制' : '模拟凭证号已复制') : '复制失败，请稍后再试');
  };

  const createArrivalIntent = async (lot) => {
    if (!lot || creatingArrivalIntent) {
      return;
    }

    const assurance = getArrivalAssurance(lot);
    const estimatedArrivalMinutes = Number(assurance?.eta_minutes || 0) > 0
      ? Number(assurance.eta_minutes)
      : Math.max(3, Math.round((lot.distanceKm || 3) / 18 * 60 + 3));

    setCreatingArrivalIntent(true);
    try {
      const response = await parkingService.createArrivalIntent({
        lot_id: lot.id,
        estimated_arrival_minutes: estimatedArrivalMinutes,
        expected_duration_minutes: paymentHours * 60
      });
      const intent = response.data?.data;
      setArrivalIntent(intent);
      if (intent?.display_code) {
        setArrivalIntentCodes((currentCodes) => [
          intent.display_code,
          ...currentCodes.filter((code) => code !== intent.display_code)
        ].slice(0, 8));
      }
      showMineView();
      setIsArrivalIntentOpen(true);
      showToast('已生成演示到场计划');
    } catch (requestError) {
      showToast(requestError.response?.data?.message || requestError.message || '到场计划生成失败');
    } finally {
      setCreatingArrivalIntent(false);
    }
  };

  const copyArrivalIntent = async (intent) => {
    const copied = await copyToClipboard(formatArrivalIntentText(intent));
    showToast(copied ? '到场计划已复制' : '复制失败，请稍后再试');
  };

  const openArrivalIntentRecord = (intent) => {
    setArrivalIntent(intent);
    setIsArrivalIntentOpen(true);
  };

  const removeArrivalIntentCode = (displayCode) => {
    setArrivalIntentCodes((currentCodes) => currentCodes.filter((code) => code !== displayCode));
    showToast('已移除本机到场计划');
  };

  return (
    <div className="min-h-screen bg-[#f7faf7] text-zinc-950">
      <header className="sticky top-0 z-20 border-b border-emerald-100/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <BrandMark size="sm" subtitle="智能停车服务" showBadge />
          </Link>
          <nav className="hidden items-center rounded-full border border-emerald-100 bg-emerald-50/80 p-1 text-sm text-zinc-600 md:flex">
            <Link to="/" className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-emerald-800">首页</Link>
            <span className="rounded-md bg-white px-3 py-1.5 font-semibold text-zinc-950 shadow-sm">停车服务</span>
            <Link to="/admin/status" className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-emerald-800">管理端</Link>
            <Link to="/admin/governance" className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-emerald-800">分析端</Link>
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
              className="hidden h-10 items-center justify-center rounded-full bg-emerald-600 px-3 text-sm font-medium text-white transition hover:bg-emerald-700 sm:inline-flex"
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
      <main className="mx-auto max-w-[1500px] px-4 pb-28 pt-3 sm:px-6 sm:pt-5 lg:px-8 lg:pb-8">
        <section className="grid gap-4 lg:grid-cols-[minmax(380px,0.66fr)_minmax(500px,1fr)]">
          <div className="min-w-0 space-y-4">
            <section className={mobileView === 'map' ? 'hidden lg:block' : 'block'}>
              <AiDecisionHero
                lot={recommendedLot}
                alternatives={assuranceAlternatives}
                analyzedCount={filteredLots.length}
                onOpenDetails={openLotDetails}
                onCreateIntent={createArrivalIntent}
	                creatingArrivalIntent={creatingArrivalIntent}
	                activeArrivalIntent={latestArrivalIntentRecord}
	                onShowMap={showMapView}
	                onShowAdjust={() => setIsAiAdjustOpen((value) => !value)}
	              />
            </section>

            {latestArrivalIntentRecord && (
              <div className={mobileView === 'map' ? 'hidden lg:block' : 'block'}>
                <ActiveGuardianStrip
                  intent={latestArrivalIntentRecord}
                  onOpen={openArrivalIntentRecord}
                  onShowMine={showMineView}
                />
              </div>
            )}

            <MobileViewTabs
              activeView={mobileView}
              onChange={setMobileView}
              arrivalIntentCount={arrivalIntentRecords.length}
            />

            <section className={`${mobileView === 'recommend' ? 'grid' : 'hidden'} gap-3 md:grid-cols-3 lg:grid`}>
              <QuickPick label="AI 首选" lot={recommendedLot} icon={Sparkles} onSelectLot={openLotDetails} />
              <QuickPick label="更稳备选" lot={assuranceAlternatives[0] || mostAvailableLot} icon={ShieldCheck} onSelectLot={openLotDetails} rank="A" />
              <QuickPick label="更近备选" lot={nearestAlternativeLot || nearestLot} icon={Navigation} onSelectLot={openLotDetails} rank="B" />
            </section>

            <section className={`${(mobileView === 'list' || isAiAdjustOpen) ? 'block' : 'hidden'} rounded-3xl border border-emerald-100 bg-white p-3 shadow-[0_14px_34px_rgba(15,23,42,0.05)] lg:block`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-950">调整 AI 停车偏好</p>
                  <p className="mt-1 text-xs text-zinc-500">AI 已先给出首选；需要时再改目的地、来源或策略。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAiAdjustOpen((value) => !value)}
                  className="hidden h-9 items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 lg:inline-flex"
                >
                  {isAiAdjustOpen ? '收起' : '展开'}
                </button>
              </div>
              <div className={`${isAiAdjustOpen || mobileView === 'list' ? 'grid' : 'hidden'} mt-3 gap-3 sm:grid-cols-[minmax(0,1fr)_230px] lg:grid`}>
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="输入目的地，AI 继续缩小推荐范围"
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
                    <option value="all">AI 融合全部来源</option>
                    {sourceOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className={`${isAiAdjustOpen || mobileView === 'list' ? 'grid' : 'hidden'} mt-3 gap-2 sm:grid-cols-2 xl:grid-cols-4 lg:grid`}>
                {sortOptions.map((option) => {
                  const Icon = option.icon;
                  const isActive = sortMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setSortMode(option.value)}
                      className={`flex min-h-[52px] items-center gap-3 rounded-2xl border px-3 text-left transition ${
                        isActive
                          ? 'border-emerald-600 bg-emerald-600 text-white shadow-[0_12px_24px_rgba(16,185,129,0.18)]'
                          : 'border-emerald-100 bg-white text-zinc-700 hover:border-emerald-200 hover:bg-emerald-50'
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

            <div className={`${mobileView === 'list' ? 'block' : 'hidden'} lg:block`}>
              {loading ? (
                <div className="flex min-h-[430px] items-center justify-center rounded-xl border border-zinc-200 bg-white">
                  <LoadingSpinner size="large" text="正在加载停车场余位..." />
                </div>
              ) : filteredLots.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-zinc-600">
                  <SlidersHorizontal className="mx-auto h-8 w-8 text-zinc-400" />
                  <p className="mt-3 font-semibold text-zinc-950">AI 暂未匹配到车场</p>
                  <p className="mt-2 text-sm">换一个目的地关键词，或恢复 AI 融合全部来源。</p>
                </div>
              ) : (
                <section id="parking-lot-list" className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-zinc-950">AI 候选池</h2>
                      <p className="mt-1 text-sm text-zinc-500">{filteredLots.length} 个结果已按当前 AI 策略排序</p>
                    </div>
                    <span className="hidden rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-500 sm:inline-flex">
                      {sortOptions.find((option) => option.value === sortMode)?.label || 'AI 推荐'}
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
          </div>

          <aside className="space-y-4 lg:sticky lg:top-[88px] lg:self-start">
            <div id="parking-map-panel" className={`${mobileView === 'map' ? 'block scroll-mt-28' : 'hidden'} lg:block`}>
              <ParkingMap
                lots={filteredLots}
                recommendedLotId={recommendedLot?.id}
                selectedLotId={selectedLot?.id}
                selectedLot={selectedLot}
	                recommendedLot={recommendedLot}
	                alternatives={selectedAlternatives}
	                activeArrivalIntent={latestArrivalIntentRecord}
	                creatingArrivalIntent={creatingArrivalIntent}
	                onSelectLot={openLotDetails}
	                onCreateIntent={createArrivalIntent}
              />
            </div>

            <SelectedLotPanel
              lot={selectedLot}
              recommendedLot={recommendedLot}
              className="hidden xl:block"
              showFullDetailsButton
              onOpenDetails={() => setIsDetailOpen(true)}
              isSaved={selectedLot ? savedLotIds.includes(String(selectedLot.id)) : false}
              isCompared={selectedLot ? compareLotIds.includes(String(selectedLot.id)) : false}
              creatingArrivalIntent={creatingArrivalIntent}
              paymentHours={paymentHours}
              onOpenPayment={openPayment}
              onCreateArrivalIntent={createArrivalIntent}
              onToggleSaved={toggleSavedLot}
              onToggleCompare={toggleCompareLot}
              onCopyLot={copyLotInfo}
              onReportDataIssue={reportDataIssue}
            />

            <div id="parking-mine" className={`${mobileView === 'mine' ? 'block' : 'hidden'} scroll-mt-28 xl:block`}>
              <ArrivalPlanList
                records={arrivalIntentRecords}
                loading={loadingArrivalIntentRecords}
                onOpen={openArrivalIntentRecord}
                onCopy={copyArrivalIntent}
                onRemove={removeArrivalIntentCode}
              />
            </div>

            <div className={`${mobileView === 'mine' ? 'mt-4 block' : 'hidden'} xl:block xl:mt-0`}>
              <LocalServiceTools
                savedLots={savedLots}
                recentLots={recentLots}
                compareLots={compareLots}
                onOpenLot={openLotDetails}
                onToggleCompare={toggleCompareLot}
                onCopyLot={copyLotInfo}
              />
            </div>

            <div className="hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm xl:block">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                数据边界
              </div>
              <PilotBoundaryNote className="mt-3 text-sm leading-6" />
            </div>

            <div className="hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm xl:block">
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

      <MobileParkingActionBar
        lot={selectedLot}
        onOpenPayment={openPayment}
        onCreateArrivalIntent={createArrivalIntent}
        creatingArrivalIntent={creatingArrivalIntent}
        onOpenMore={() => setIsMoreActionsOpen(true)}
      />
      <MobileMoreActionsSheet
        lot={selectedLot}
        isOpen={isMoreActionsOpen}
        isSaved={selectedLot ? savedLotIds.includes(String(selectedLot.id)) : false}
        isCompared={selectedLot ? compareLotIds.includes(String(selectedLot.id)) : false}
        creatingArrivalIntent={creatingArrivalIntent}
        onClose={() => setIsMoreActionsOpen(false)}
        onOpenDetails={(lot) => openLotDetails(lot)}
        onOpenPayment={openPayment}
        onCreateArrivalIntent={createArrivalIntent}
        onToggleSaved={toggleSavedLot}
        onToggleCompare={toggleCompareLot}
        onCopyLot={copyLotInfo}
        onReportDataIssue={reportDataIssue}
        onShowList={showMobileList}
      />
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
        isSaved={selectedLot ? savedLotIds.includes(String(selectedLot.id)) : false}
        isCompared={selectedLot ? compareLotIds.includes(String(selectedLot.id)) : false}
        onToggleSaved={toggleSavedLot}
        onToggleCompare={toggleCompareLot}
        onCopyLot={copyLotInfo}
        onReportDataIssue={reportDataIssue}
        onOpenPayment={openPayment}
        onCreateArrivalIntent={createArrivalIntent}
        creatingArrivalIntent={creatingArrivalIntent}
        paymentHours={paymentHours}
      />
      <PaymentSimulationDrawer
        lot={paymentLot}
        isOpen={isPaymentOpen}
        hours={paymentHours}
        receipt={paymentReceipt}
        onChangeHours={setPaymentHours}
        onClose={() => setIsPaymentOpen(false)}
        onConfirm={confirmPaymentSimulation}
        onCopyReceipt={copyPaymentReceipt}
      />
      <ArrivalIntentDrawer
        intent={arrivalIntent}
        isOpen={isArrivalIntentOpen}
        onClose={() => setIsArrivalIntentOpen(false)}
        onCopy={copyArrivalIntent}
      />
      <ParkingToast message={toastMessage} />
    </div>
  );
};

export default ParkingLotsPage;
