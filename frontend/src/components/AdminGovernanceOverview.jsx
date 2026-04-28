import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  ChartBarIcon,
  CircleStackIcon,
  ClipboardDocumentCheckIcon,
  ExclamationTriangleIcon,
  LinkIcon,
  MapIcon,
  MapPinIcon,
  NoSymbolIcon
} from '@heroicons/react/24/outline';
import { adminService, parkingService } from '../services/api';
import LoadingSpinner from './LoadingSpinner';

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const getMetadata = (lot) => lot?.slot_configuration?.metadata || {};

const getLotStats = (lot) => {
  const stats = lot?.statistics || {};
  const total = Number(stats.total_slots ?? lot?.total_slots ?? 0);
  const occupied = Number(stats.occupied_slots ?? 0);
  const available = Number(stats.available_slots ?? Math.max(total - occupied, 0));
  const occupancy = total > 0 ? Math.round((occupied / total) * 1000) / 10 : 0;

  return {
    total,
    occupied,
    available,
    occupancy
  };
};

const getManagedPoint = (lot) => {
  const metadata = getMetadata(lot);
  const latitude = toNumber(metadata.latitude);
  const longitude = toNumber(metadata.longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    id: `lot-${lot.id}`,
    kind: 'managed',
    name: lot.name,
    latitude,
    longitude,
    source: metadata.source_type || 'managed',
    district: metadata.district || '未知区域',
    address: metadata.address || '暂无地址',
    stats: getLotStats(lot)
  };
};

const getCandidatePoint = (candidate) => {
  const latitude = toNumber(candidate.latitude);
  const longitude = toNumber(candidate.longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    id: `candidate-${candidate.id}`,
    kind: 'candidate',
    name: candidate.name || candidate.external_id,
    latitude,
    longitude,
    source: candidate.source_key,
    district: '开放地图候选',
    address: candidate.external_id,
    parking_type: candidate.parking_type || 'parking',
    access: candidate.access || '未知',
    fee: candidate.fee || '未知',
    capacity: candidate.capacity
  };
};

const getBounds = (points) => {
  if (points.length === 0) {
    return {
      minLat: 39.9,
      maxLat: 40.05,
      minLng: 116.25,
      maxLng: 116.45
    };
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latPadding = Math.max((maxLat - minLat) * 0.12, 0.004);
  const lngPadding = Math.max((maxLng - minLng) * 0.12, 0.004);

  return {
    minLat: minLat - latPadding,
    maxLat: maxLat + latPadding,
    minLng: minLng - lngPadding,
    maxLng: maxLng + lngPadding
  };
};

const projectPoint = (point, bounds) => {
  const width = 1000;
  const height = 620;
  const padding = 54;
  const lngSpan = Math.max(bounds.maxLng - bounds.minLng, 0.0001);
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.0001);

  return {
    x: padding + ((point.longitude - bounds.minLng) / lngSpan) * (width - padding * 2),
    y: padding + ((bounds.maxLat - point.latitude) / latSpan) * (height - padding * 2)
  };
};

const getOccupancyTone = (occupancy) => {
  if (occupancy >= 90) {
    return 'text-red-700 bg-red-50 border-red-200';
  }
  if (occupancy >= 75) {
    return 'text-orange-700 bg-orange-50 border-orange-200';
  }
  if (occupancy >= 50) {
    return 'text-amber-700 bg-amber-50 border-amber-200';
  }
  return 'text-emerald-700 bg-emerald-50 border-emerald-200';
};

const candidateReviewLabels = {
  candidate: '待核验',
  shortlisted: '重点关注',
  linked: '已关联',
  rejected: '已剔除'
};

const getCandidateReviewClassName = (status) => {
  switch (status) {
    case 'linked':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'shortlisted':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    case 'rejected':
      return 'border-slate-200 bg-slate-100 text-slate-500';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700';
  }
};

const formatCoordinate = (value) => {
  const number = toNumber(value);
  return number === null ? '未知' : number.toFixed(5);
};

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const getDistanceMeters = (first, second) => {
  if (!first || !second) {
    return null;
  }

  const earthRadiusMeters = 6371000;
  const deltaLatitude = toRadians(second.latitude - first.latitude);
  const deltaLongitude = toRadians(second.longitude - first.longitude);
  const startLatitude = toRadians(first.latitude);
  const endLatitude = toRadians(second.latitude);

  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(deltaLongitude / 2) ** 2;

  return Math.round(earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)));
};

const formatDistance = (meters) => {
  if (meters === null || meters === undefined) {
    return '暂无距离';
  }

  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }

  return `${meters} m`;
};

const getCandidateMissingFields = (candidate) => {
  const missing = [];

  if (!candidate.name) {
    missing.push('名称');
  }
  if (toNumber(candidate.capacity) === null) {
    missing.push('泊位数');
  }
  if (!candidate.fee || candidate.fee === 'unknown') {
    missing.push('收费');
  }
  if (!candidate.access || candidate.access === 'unknown') {
    missing.push('开放性');
  }
  if (toNumber(candidate.latitude) === null || toNumber(candidate.longitude) === null) {
    missing.push('坐标');
  }

  return missing;
};

const getCandidateCompleteness = (candidate) => {
  const totalFields = 5;
  const completedFields = totalFields - getCandidateMissingFields(candidate).length;
  return Math.round((completedFields / totalFields) * 100);
};

const getNearestManagedLot = (candidate, managedPoints) => {
  const candidateLatitude = toNumber(candidate.latitude);
  const candidateLongitude = toNumber(candidate.longitude);

  if (candidateLatitude === null || candidateLongitude === null || managedPoints.length === 0) {
    return null;
  }

  const candidatePoint = {
    latitude: candidateLatitude,
    longitude: candidateLongitude
  };

  return managedPoints
    .map((lot) => ({
      ...lot,
      distanceMeters: getDistanceMeters(candidatePoint, lot)
    }))
    .filter((lot) => lot.distanceMeters !== null)
    .sort((first, second) => first.distanceMeters - second.distanceMeters)[0] || null;
};

const getGovernanceAdvice = (candidate, nearestLot, missingFields) => {
  if (candidate.review_status === 'linked') {
    return {
      label: '已完成来源关联',
      detail: '该候选点已作为外部来源引用关联到正式停车场。',
      tone: 'ok'
    };
  }

  if (candidate.review_status === 'rejected') {
    return {
      label: '暂不采纳',
      detail: '该候选点已从有效候选队列中剔除。',
      tone: 'muted'
    };
  }

  if (nearestLot && nearestLot.distanceMeters <= 120) {
    return {
      label: '疑似重复，优先关联',
      detail: `距离 ${nearestLot.name} ${formatDistance(nearestLot.distanceMeters)}，建议核对是否为同一停车资源。`,
      tone: 'warning'
    };
  }

  if (missingFields.length <= 1 && candidate.name) {
    return {
      label: '适合进入实地核验',
      detail: '名称和空间位置较完整，可进入校园调研或官方数据交叉核验。',
      tone: 'info'
    };
  }

  if (missingFields.length >= 3) {
    return {
      label: '先补关键字段',
      detail: `缺少 ${missingFields.join('、')}，暂不宜纳入正式停车场。`,
      tone: 'muted'
    };
  }

  return {
    label: '保留候选，继续比对',
    detail: '信息基本可用，但仍需和官方/校园来源核验。',
    tone: 'info'
  };
};

const getAdviceClassName = (tone) => {
  switch (tone) {
    case 'ok':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'info':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600';
  }
};

const AdminGovernanceOverview = () => {
  const [lots, setLots] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [dataSources, setDataSources] = useState([]);
  const [governanceSummary, setGovernanceSummary] = useState(null);
  const [showManaged, setShowManaged] = useState(true);
  const [showCandidates, setShowCandidates] = useState(true);
  const [candidateReviewFilter, setCandidateReviewFilter] = useState('active');
  const [candidateLinks, setCandidateLinks] = useState({});
  const [selectedCandidateIds, setSelectedCandidateIds] = useState([]);
  const [savingCandidateId, setSavingCandidateId] = useState(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      const [lotsResponse, candidatesResponse, sourcesResponse, governanceResponse] = await Promise.all([
        parkingService.getAllParkingLots(),
        adminService.getParkingLotCandidates({ limit: 200 }),
        adminService.getDataSources(),
        adminService.getGovernanceSummary()
      ]);

      setLots(lotsResponse.data?.data?.parking_lots || lotsResponse.data?.data || []);
      const nextCandidates = candidatesResponse.data?.data?.parking_lot_candidates || [];
      setCandidates(nextCandidates);
      setCandidateLinks(
        nextCandidates.reduce((accumulator, candidate) => {
          if (candidate.linked_parking_lot_id) {
            accumulator[candidate.id] = String(candidate.linked_parking_lot_id);
          }
          return accumulator;
        }, {})
      );
      setDataSources(sourcesResponse.data?.data?.data_sources || []);
      setGovernanceSummary(governanceResponse.data?.data || null);
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || '治理概览数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const managedPoints = useMemo(() => lots.map(getManagedPoint).filter(Boolean), [lots]);
  const activeCandidates = useMemo(() => candidates.filter((candidate) => candidate.review_status !== 'rejected'), [candidates]);
  const candidatePoints = useMemo(() => activeCandidates.map(getCandidatePoint).filter(Boolean), [activeCandidates]);

  const visiblePoints = useMemo(() => {
    return [
      ...(showManaged ? managedPoints : []),
      ...(showCandidates ? candidatePoints : [])
    ];
  }, [managedPoints, candidatePoints, showManaged, showCandidates]);

  const bounds = useMemo(() => getBounds(visiblePoints.length > 0 ? visiblePoints : [...managedPoints, ...candidatePoints]), [visiblePoints, managedPoints, candidatePoints]);

  const p0Sources = useMemo(() => dataSources.filter((source) => source.priority === 'P0'), [dataSources]);
  const importedP0Sources = p0Sources.filter((source) => source.latest_import_status === 'completed').length;
  const highOccupancyLots = lots.filter((lot) => getLotStats(lot).occupancy >= 75);
  const geocodedManagedRatio = lots.length > 0 ? Math.round((managedPoints.length / lots.length) * 100) : 0;
  const shortlistedCandidates = candidates.filter((candidate) => candidate.review_status === 'shortlisted').length;
  const linkedCandidates = candidates.filter((candidate) => candidate.review_status === 'linked').length;
  const rejectedCandidates = candidates.filter((candidate) => candidate.review_status === 'rejected').length;

  const candidateGovernanceRows = useMemo(() => {
    const statusPriority = {
      shortlisted: 0,
      candidate: 1,
      linked: 2,
      rejected: 3
    };

    return candidates
      .map((candidate) => {
        const nearestLot = getNearestManagedLot(candidate, managedPoints);
        const missingFields = getCandidateMissingFields(candidate);
        const completeness = getCandidateCompleteness(candidate);
        const advice = getGovernanceAdvice(candidate, nearestLot, missingFields);

        return {
          candidate,
          nearestLot,
          missingFields,
          completeness,
          advice
        };
      })
      .sort((first, second) => {
        return (statusPriority[first.candidate.review_status] ?? 4) - (statusPriority[second.candidate.review_status] ?? 4)
          || Number(second.completeness) - Number(first.completeness)
          || (first.nearestLot?.distanceMeters ?? Number.POSITIVE_INFINITY) - (second.nearestLot?.distanceMeters ?? Number.POSITIVE_INFINITY);
      });
  }, [candidates, managedPoints]);

  const activeGovernanceRows = candidateGovernanceRows.filter((row) => row.candidate.review_status !== 'rejected');
  const duplicateRiskCount = activeGovernanceRows.filter((row) => row.nearestLot && row.nearestLot.distanceMeters <= 120 && row.candidate.review_status !== 'linked').length;
  const fieldReadyCount = activeGovernanceRows.filter((row) => row.missingFields.length <= 1 && row.candidate.review_status !== 'linked').length;
  const lowCompletenessCount = activeGovernanceRows.filter((row) => row.completeness < 60).length;

  const districtSummary = useMemo(() => {
    const grouped = new Map();

    lots.forEach((lot) => {
      const metadata = getMetadata(lot);
      const district = metadata.district || '未知区域';
      const stats = getLotStats(lot);
      const current = grouped.get(district) || {
        district,
        lots: 0,
        total: 0,
        available: 0,
        occupied: 0
      };

      current.lots += 1;
      current.total += stats.total;
      current.available += stats.available;
      current.occupied += stats.occupied;
      grouped.set(district, current);
    });

    return Array.from(grouped.values())
      .map((item) => ({
        ...item,
        occupancy: item.total > 0 ? Math.round((item.occupied / item.total) * 1000) / 10 : 0
      }))
      .sort((first, second) => second.occupancy - first.occupancy);
  }, [lots]);

  const observations = useMemo(() => {
    const next = [];

    if (highOccupancyLots.length > 0) {
      next.push({
        title: '高占用停车场需要重点观察',
        body: `${highOccupancyLots.length} 个正式停车场占用率达到 75% 以上，可作为拥堵预警和巡查优先级依据。`,
        tone: 'warning'
      });
    } else {
      next.push({
        title: '正式停车场当前未触发高占用阈值',
        body: '现有样例数据没有达到 75% 以上的高占用预警，但仍需要接入真实时段数据验证高峰规律。',
        tone: 'ok'
      });
    }

    if (candidatePoints.length > managedPoints.length * 10) {
      next.push({
        title: '开放地图候选点明显多于已管理停车场',
        body: `当前有 ${candidatePoints.length} 个候选 POI、${managedPoints.length} 个有坐标的正式停车场，适合后续做人工筛选和官方数据比对。`,
        tone: 'info'
      });
    }

    if (shortlistedCandidates > 0 || linkedCandidates > 0) {
      next.push({
        title: '候选停车资源开始进入核验流程',
        body: `当前已有 ${shortlistedCandidates} 个重点关注候选点、${linkedCandidates} 个已关联正式停车场，可继续和校园调研或官方数据交叉核验。`,
        tone: 'info'
      });
    }

    if (importedP0Sources < p0Sources.length) {
      next.push({
        title: '核心官方数据源仍需补齐',
        body: `P0 数据源已完成 ${importedP0Sources}/${p0Sources.length} 个导入闭环，下一步应优先处理实时停车泊位和收费标准。`,
        tone: 'warning'
      });
    }

    if (geocodedManagedRatio < 100) {
      next.push({
        title: '正式停车场坐标仍需规范化',
        body: `当前正式停车场坐标覆盖率为 ${geocodedManagedRatio}%，后续接入 PostGIS 前应补齐经纬度。`,
        tone: 'info'
      });
    }

    return next;
  }, [highOccupancyLots.length, candidatePoints.length, managedPoints.length, importedP0Sources, p0Sources.length, geocodedManagedRatio, shortlistedCandidates, linkedCandidates]);

  const candidateReviewQueue = useMemo(() => {
    return candidates
      .filter((candidate) => {
        if (candidateReviewFilter === 'active') {
          return candidate.review_status !== 'rejected';
        }
        return candidate.review_status === candidateReviewFilter;
      })
      .sort((first, second) => {
        const priority = {
          linked: 0,
          shortlisted: 1,
          candidate: 2,
          rejected: 3
        };
        return (priority[first.review_status] ?? 4) - (priority[second.review_status] ?? 4)
          || Number(Boolean(second.name)) - Number(Boolean(first.name));
      });
  }, [candidates, candidateReviewFilter]);

  const visibleCandidateIds = useMemo(() => candidateReviewQueue.map((candidate) => candidate.id), [candidateReviewQueue]);
  const selectedCandidateRows = useMemo(() => {
    const selectedIds = new Set(selectedCandidateIds);
    return candidateReviewQueue.filter((candidate) => selectedIds.has(candidate.id));
  }, [candidateReviewQueue, selectedCandidateIds]);
  const governanceDistrictRows = governanceSummary?.districts?.length > 0 ? governanceSummary.districts : districtSummary;
  const governanceRecommendations = governanceSummary?.recommendations || [];
  const peakHours = governanceSummary?.peak_hours || [];
  const pressureReliefCandidates = activeGovernanceRows.filter((row) => (
    row.nearestLot
    && row.nearestLot.stats.occupancy >= 75
    && row.nearestLot.distanceMeters <= 800
    && row.candidate.review_status !== 'linked'
  ));
  const topPressureLots = highOccupancyLots
    .map((lot) => ({
      ...lot,
      stats: getLotStats(lot),
      metadata: getMetadata(lot)
    }))
    .sort((first, second) => second.stats.occupancy - first.stats.occupancy)
    .slice(0, 3);
  const highPressureDistricts = governanceDistrictRows.filter((district) => Number(district.occupancy_rate ?? district.occupancy ?? 0) >= 75);
  const diversionScenarios = useMemo(() => {
    return topPressureLots
      .map((pressureLot) => {
        const pressurePoint = getManagedPoint(pressureLot);
        const pressureStats = pressureLot.stats;
        const alternatives = lots
          .filter((lot) => lot.id !== pressureLot.id)
          .map((lot) => {
            const point = getManagedPoint(lot);
            const stats = getLotStats(lot);
            if (!point || !pressurePoint || stats.total <= 0) {
              return null;
            }
            return {
              lot,
              point,
              stats,
              metadata: getMetadata(lot),
              distanceMeters: getDistanceMeters(pressurePoint, point),
              occupancyGap: Math.round((pressureStats.occupancy - stats.occupancy) * 10) / 10,
              availableGain: stats.available - pressureStats.available
            };
          })
          .filter(Boolean)
          .filter((alternative) => (
            alternative.distanceMeters !== null
            && alternative.distanceMeters <= 6000
            && alternative.stats.available > pressureStats.available
            && alternative.stats.occupancy <= pressureStats.occupancy - 5
          ))
          .sort((first, second) => (
            second.availableGain - first.availableGain
            || second.occupancyGap - first.occupancyGap
            || first.distanceMeters - second.distanceMeters
          ));

        const nearbyCandidates = pressureReliefCandidates.filter((row) => row.nearestLot?.id === `lot-${pressureLot.id}`).length;

        return {
          pressureLot,
          alternative: alternatives[0] || null,
          nearbyCandidates
        };
      })
      .filter((scenario) => scenario.alternative || scenario.nearbyCandidates > 0)
      .slice(0, 2);
  }, [lots, pressureReliefCandidates, topPressureLots]);

  const toggleCandidateSelection = (candidateId) => {
    setSelectedCandidateIds((current) => (
      current.includes(candidateId)
        ? current.filter((id) => id !== candidateId)
        : [...current, candidateId]
    ));
  };

  const toggleVisibleCandidateSelection = () => {
    setSelectedCandidateIds((current) => {
      const visibleSet = new Set(visibleCandidateIds);
      const allVisibleSelected = visibleCandidateIds.length > 0 && visibleCandidateIds.every((id) => current.includes(id));

      if (allVisibleSelected) {
        return current.filter((id) => !visibleSet.has(id));
      }

      return Array.from(new Set([...current, ...visibleCandidateIds]));
    });
  };

  const handleCandidateLinkChange = (candidateId, value) => {
    setCandidateLinks((current) => ({
      ...current,
      [candidateId]: value
    }));
  };

  const updateCandidateInState = (updatedCandidate) => {
    setCandidates((current) => current.map((candidate) => (
      candidate.id === updatedCandidate.id ? { ...candidate, ...updatedCandidate } : candidate
    )));

    setCandidateLinks((current) => ({
      ...current,
      [updatedCandidate.id]: updatedCandidate.linked_parking_lot_id ? String(updatedCandidate.linked_parking_lot_id) : ''
    }));
  };

  const handleCandidateReview = async (candidate, reviewStatus) => {
    const selectedLotId = candidateLinks[candidate.id] || candidate.linked_parking_lot_id || '';

    if (reviewStatus === 'linked' && !selectedLotId) {
      setError('请选择一个正式停车场后再关联候选点。');
      return;
    }

    setSavingCandidateId(candidate.id);
    setError('');

    try {
      const response = await adminService.updateParkingLotCandidateReview(candidate.id, {
        review_status: reviewStatus,
        linked_parking_lot_id: reviewStatus === 'linked' ? Number(selectedLotId) : null,
        review_notes: reviewStatus === 'linked'
          ? '人工核验：候选 POI 与正式停车场关联'
          : reviewStatus === 'shortlisted'
            ? '人工核验：列入重点关注候选资源'
            : reviewStatus === 'rejected'
              ? '人工核验：暂不纳入停车资源池'
              : '人工核验：恢复为待核验'
      });

      const updatedCandidate = response.data?.data?.parking_lot_candidate;
      if (updatedCandidate) {
        updateCandidateInState(updatedCandidate);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || '候选点审核更新失败');
    } finally {
      setSavingCandidateId(null);
    }
  };

  const handleBulkCandidateReview = async (reviewStatus) => {
    const rows = selectedCandidateRows;

    if (rows.length === 0) {
      setError('请先选择候选点。');
      return;
    }

    setBulkSaving(true);
    setError('');

    try {
      const updatedCandidates = [];

      for (const candidate of rows) {
        const response = await adminService.updateParkingLotCandidateReview(candidate.id, {
          review_status: reviewStatus,
          linked_parking_lot_id: null,
          review_notes: reviewStatus === 'shortlisted'
            ? '批量核验：列入待调研/重点关注候选资源'
            : reviewStatus === 'rejected'
              ? '批量核验：暂不纳入停车资源池'
              : '批量核验：恢复为待核验'
        });

        const updatedCandidate = response.data?.data?.parking_lot_candidate;
        if (updatedCandidate) {
          updatedCandidates.push(updatedCandidate);
        }
      }

      updatedCandidates.forEach(updateCandidateInState);
      setSelectedCandidateIds([]);
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || '批量候选点审核失败');
    } finally {
      setBulkSaving(false);
    }
  };

  const plottedManagedPoints = managedPoints.map((point) => ({
    ...point,
    ...projectPoint(point, bounds)
  }));
  const plottedCandidatePoints = candidatePoints.map((point) => ({
    ...point,
    ...projectPoint(point, bounds)
  }));

  return (
    <div className="space-y-6 text-zinc-950">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Governance Console</p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-950">ParkGov AI 治理分析工作台</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            对正式停车场、开放地图候选 POI、区域占用率和核心数据源进行交叉核验，用于校园试点和城市公共停车治理分析雏形。
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="inline-flex w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          <ArrowPathIcon className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新概览
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Managed Lots</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-950">{lots.length}</p>
          <p className="mt-1 text-xs text-zinc-500">正式停车场</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Geocoded</p>
          <p className="mt-2 text-3xl font-semibold text-blue-700">{geocodedManagedRatio}%</p>
          <p className="mt-1 text-xs text-zinc-500">坐标覆盖率</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Candidate POI</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-950">{candidatePoints.length}</p>
          <p className="mt-1 text-xs text-zinc-500">开放地图候选</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Reviewed</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-700">{shortlistedCandidates}/{linkedCandidates}</p>
          <p className="mt-1 text-xs text-zinc-500">重点 / 已关联</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">P0 Sources</p>
          <p className="mt-2 text-3xl font-semibold text-amber-700">{importedP0Sources}/{p0Sources.length || 0}</p>
          <p className="mt-1 text-xs text-zinc-500">核心数据闭环</p>
        </div>
      </section>

      {loading ? (
        <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-slate-200 bg-white">
          <LoadingSpinner text="正在加载治理概览..." />
        </div>
      ) : (
        <>
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <ChartBarIcon className="h-5 w-5 text-blue-700" />
                <h2 className="font-semibold text-slate-950">治理汇总分析</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                由后端 `/api/admin/governance/summary` 汇总区域利用率、候选点状态和 AI 识别时段信号。
              </p>
            </div>
            <div className="grid gap-0 divide-y divide-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0">
              <div className="p-5">
                <p className="text-sm text-slate-500">高占用区域</p>
                <p className="mt-1 text-3xl font-semibold text-orange-700">
                  {governanceDistrictRows.filter((district) => Number(district.occupancy_rate ?? district.occupancy ?? 0) >= 75).length}
                </p>
                <p className="mt-2 text-sm text-slate-600">按 district 聚合正式停车场占用率。</p>
              </div>
              <div className="p-5">
                <p className="text-sm text-slate-500">候选资源</p>
                <p className="mt-1 text-3xl font-semibold text-blue-700">
                  {governanceSummary?.candidates?.total ?? candidates.length}
                </p>
                <p className="mt-2 text-sm text-slate-600">用于人工核验、调研和资源补全。</p>
              </div>
              <div className="p-5">
                <p className="text-sm text-slate-500">AI 时段样本</p>
                <p className="mt-1 text-3xl font-semibold text-emerald-700">{peakHours.length}</p>
                <p className="mt-2 text-sm text-slate-600">最近 30 天 inference_events 小时聚合。</p>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="font-semibold text-slate-950">后端建议</h2>
            </div>
            {governanceRecommendations.length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-500">暂无自动建议，等待更多样本数据。</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {governanceRecommendations.map((recommendation) => (
                  <article key={recommendation.type} className="px-5 py-4">
                    <p className="text-sm font-semibold text-slate-950">{recommendation.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{recommendation.description}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-emerald-200 bg-white">
          <div className="border-b border-emerald-100 bg-emerald-50/60 px-5 py-4">
            <div className="flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5 text-emerald-800" />
              <h2 className="font-semibold text-slate-950">分流治理价值模拟</h2>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              用正式停车场占用率和候选 POI 距离做保守初筛，判断哪些压力点适合做诱导分流、现场核验或数据补强。
            </p>
          </div>
          <div className="grid gap-0 divide-y divide-slate-100 lg:grid-cols-[1.1fr_0.9fr] lg:divide-x lg:divide-y-0">
            <div className="p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">高压区域</p>
                  <p className="mt-1 text-3xl font-semibold text-orange-700">{highPressureDistricts.length}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">高占用停车场</p>
                  <p className="mt-1 text-3xl font-semibold text-orange-700">{topPressureLots.length}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">周边候选资源</p>
                  <p className="mt-1 text-3xl font-semibold text-emerald-700">{pressureReliefCandidates.length}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                这不是“替代导航”，而是给治理端看的压力分流线索：当正式停车场高占用时，周边候选 POI 可进入人工调研、开放性核验和诱导策略设计。
              </p>
              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-950">分流前后对比</p>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    建议 / 候选 / 待核验
                  </span>
                </div>
                {diversionScenarios.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                    当前样例还没有形成可解释的替代分流组合。后续接入更多校园停车场坐标、余位和候选 POI 后，这里会展示“高压点到推荐备选点”的对比。
                  </div>
                ) : (
                  diversionScenarios.map((scenario) => {
                    const alternative = scenario.alternative;
                    return (
                      <article key={scenario.pressureLot.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                          <div>
                            <p className="text-xs font-medium text-orange-700">原压力点</p>
                            <p className="mt-1 text-sm font-semibold text-slate-950">{scenario.pressureLot.name}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              占用 {scenario.pressureLot.stats.occupancy}% · 剩余 {scenario.pressureLot.stats.available}/{scenario.pressureLot.stats.total}
                            </p>
                          </div>
                          <div className="hidden text-slate-400 md:block">→</div>
                          <div>
                            <p className="text-xs font-medium text-emerald-700">ParkGov 分流建议</p>
                            {alternative ? (
                              <>
                                <p className="mt-1 text-sm font-semibold text-slate-950">{alternative.lot.name}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  剩余 +{Math.max(alternative.availableGain, 0)} · 占用低 {Math.max(alternative.occupancyGap, 0).toFixed(1)} 个百分点 · {formatDistance(alternative.distanceMeters)}
                                </p>
                              </>
                            ) : (
                              <p className="mt-1 text-sm text-slate-600">暂无正式备选停车场，优先核验周边候选资源。</p>
                            )}
                          </div>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-slate-500">
                          周边候选资源 {scenario.nearbyCandidates} 个。该建议只用于治理研判和诱导策略设计，不代表候选资源已可停车。
                        </p>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {topPressureLots.length === 0 ? (
                <div className="px-5 py-6 text-sm text-slate-500">当前样例没有高占用压力点，等待更多高峰时段数据。</div>
              ) : (
                topPressureLots.map((lot) => {
                  const nearbyCandidates = pressureReliefCandidates.filter((row) => row.nearestLot?.id === `lot-${lot.id}`).length;
                  return (
                    <article key={lot.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-950">{lot.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{lot.metadata.district || '未知区域'} · 剩余 {lot.stats.available}/{lot.stats.total}</p>
                        </div>
                        <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
                          占用 {lot.stats.occupancy}%
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">
                        周边 800m 内有 {nearbyCandidates} 个候选资源可进入核验；建议使用“建议/候选/待调研”表述，不视为真实可用泊位。
                      </p>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </section>

        {peakHours.length > 0 && (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="font-semibold text-slate-950">AI 识别高峰时段雏形</h2>
              <p className="mt-1 text-sm text-slate-500">当前只基于标准识别事件样本统计，不代表真实城市高峰规律。</p>
            </div>
            <div className="divide-y divide-slate-100">
              {peakHours.map((hour) => (
                <div key={hour.hour} className="grid gap-3 px-5 py-4 md:grid-cols-[120px_1fr_160px] md:items-center">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{String(hour.hour).padStart(2, '0')}:00</p>
                    <p className="text-xs text-slate-500">{hour.event_count} 条事件</p>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{ width: `${Math.min(Number(hour.avg_occupancy_rate || 0), 100)}%` }}
                    />
                  </div>
                  <p className="text-sm text-slate-600">平均占用 {hour.avg_occupancy_rate ?? '暂无'}%</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardDocumentCheckIcon className="h-5 w-5 text-blue-700" />
                <h2 className="font-semibold text-slate-950">候选资源治理工作台</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                按字段完整度、最近正式停车场距离和人工核验状态，识别可调研、疑似重复和需补字段的候选点。
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm sm:min-w-[420px]">
              <div>
                <p className="text-xs text-slate-500">疑似重复</p>
                <p className="mt-1 text-lg font-semibold text-amber-700">{duplicateRiskCount}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">可调研</p>
                <p className="mt-1 text-lg font-semibold text-blue-700">{fieldReadyCount}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">低完整度</p>
                <p className="mt-1 text-lg font-semibold text-slate-700">{lowCompletenessCount}</p>
              </div>
            </div>
          </div>

          {activeGovernanceRows.length === 0 ? (
            <div className="px-5 py-8 text-sm text-slate-500">暂无有效候选资源</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">候选资源</th>
                    <th className="px-5 py-3">最近正式停车场</th>
                    <th className="px-5 py-3">字段完整度</th>
                    <th className="px-5 py-3">治理建议</th>
                    <th className="px-5 py-3">核验操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {activeGovernanceRows.slice(0, 10).map((row) => {
                    const { candidate, nearestLot, missingFields, completeness, advice } = row;
                    const currentLinkValue = candidateLinks[candidate.id] || '';
                    const isSaving = savingCandidateId === candidate.id;

                    return (
                      <tr key={candidate.id} className="align-top">
                        <td className="px-5 py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-slate-950">{candidate.name || candidate.external_id}</p>
                              <p className="mt-1 text-xs text-slate-500">{candidate.source_key} · {candidate.external_id}</p>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${getCandidateReviewClassName(candidate.review_status)}`}>
                              {candidateReviewLabels[candidate.review_status] || candidate.review_status || '待核验'}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            {formatCoordinate(candidate.latitude)}, {formatCoordinate(candidate.longitude)}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          {nearestLot ? (
                            <div>
                              <p className="font-medium text-slate-800">{nearestLot.name}</p>
                              <p className="mt-1 text-xs text-slate-500">{formatDistance(nearestLot.distanceMeters)}</p>
                            </div>
                          ) : (
                            <span className="text-slate-500">暂无可比对停车场</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <div className="w-32">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-700">{completeness}%</span>
                              <span className="text-slate-500">{missingFields.length === 0 ? '完整' : `缺 ${missingFields.length} 项`}</span>
                            </div>
                            <div className="mt-2 h-2 rounded-full bg-slate-100">
                              <div
                                className={`h-2 rounded-full ${completeness >= 80 ? 'bg-emerald-500' : completeness >= 60 ? 'bg-blue-500' : 'bg-amber-500'}`}
                                style={{ width: `${completeness}%` }}
                              />
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                              {missingFields.length === 0 ? '暂无字段缺口' : missingFields.join('、')}
                            </p>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getAdviceClassName(advice.tone)}`}>
                            {advice.label}
                          </span>
                          <p className="mt-2 max-w-xs text-xs leading-5 text-slate-500">{advice.detail}</p>
                        </td>
                        <td className="px-5 py-4">
                          <div className="min-w-[220px] space-y-2">
                            <select
                              value={currentLinkValue}
                              onChange={(event) => handleCandidateLinkChange(candidate.id, event.target.value)}
                              className="form-input text-xs"
                            >
                              <option value="">选择正式停车场</option>
                              {lots.map((lot) => (
                                <option key={lot.id} value={lot.id}>
                                  {lot.name}
                                </option>
                              ))}
                            </select>
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => handleCandidateReview(candidate, 'shortlisted')}
                                className="inline-flex items-center justify-center rounded-md border border-blue-200 px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                              >
                                <ClipboardDocumentCheckIcon className="mr-1 h-3.5 w-3.5" />
                                关注
                              </button>
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => handleCandidateReview(candidate, 'linked')}
                                className="inline-flex items-center justify-center rounded-md border border-emerald-200 px-2 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                              >
                                <LinkIcon className="mr-1 h-3.5 w-3.5" />
                                关联
                              </button>
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => handleCandidateReview(candidate, 'rejected')}
                                className="inline-flex items-center justify-center rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                              >
                                <NoSymbolIcon className="mr-1 h-3.5 w-3.5" />
                                剔除
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.8fr)]">
          <div className="space-y-5">
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <MapIcon className="h-5 w-5 text-blue-700" />
                    <h2 className="font-semibold text-slate-950">空间分布视图</h2>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">轻量经纬度散点视图，不代表精确地图底图。</p>
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showManaged}
                      onChange={(event) => setShowManaged(event.target.checked)}
                      className="rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                    />
                    正式停车场
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showCandidates}
                      onChange={(event) => setShowCandidates(event.target.checked)}
                      className="rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                    />
                    OSM 候选点
                  </label>
                </div>
              </div>

              <div className="p-4">
                <svg viewBox="0 0 1000 620" className="h-[420px] w-full rounded-md bg-slate-50">
                  <rect x="0" y="0" width="1000" height="620" fill="#f8fafc" />
                  {[0, 1, 2, 3, 4].map((index) => (
                    <g key={index}>
                      <line x1={80 + index * 210} y1="54" x2={80 + index * 210} y2="566" stroke="#e2e8f0" strokeWidth="1" />
                      <line x1="54" y1={80 + index * 110} x2="946" y2={80 + index * 110} stroke="#e2e8f0" strokeWidth="1" />
                    </g>
                  ))}
                  <rect x="54" y="54" width="892" height="512" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />

                  {showCandidates && plottedCandidatePoints.map((point) => (
                    <circle
                      key={point.id}
                      cx={point.x}
                      cy={point.y}
                      r={point.name === point.address ? 3.2 : 4.3}
                      fill="#2563eb"
                      opacity={point.name === point.address ? 0.34 : 0.58}
                    >
                      <title>{point.name} · {formatCoordinate(point.latitude)}, {formatCoordinate(point.longitude)}</title>
                    </circle>
                  ))}

                  {showManaged && plottedManagedPoints.map((point) => (
                    <g key={point.id}>
                      <circle cx={point.x} cy={point.y} r="11" fill="#0f172a" opacity="0.12" />
                      <circle cx={point.x} cy={point.y} r="6.5" fill="#059669" stroke="#ffffff" strokeWidth="2">
                        <title>{point.name} · 剩余 {point.stats.available}/{point.stats.total}</title>
                      </circle>
                    </g>
                  ))}

                  <text x="64" y="596" fill="#64748b" fontSize="18">
                    lng {formatCoordinate(bounds.minLng)} - {formatCoordinate(bounds.maxLng)}
                  </text>
                  <text x="724" y="596" fill="#64748b" fontSize="18">
                    lat {formatCoordinate(bounds.minLat)} - {formatCoordinate(bounds.maxLat)}
                  </text>
                </svg>

                <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-600">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-emerald-600" />
                    正式停车场
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-blue-700 opacity-60" />
                    OSM/Overpass 候选 POI
                  </span>
                  <span>候选点只作空间补全，不代表余位或管理权属。</span>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-2">
                  <CircleStackIcon className="h-5 w-5 text-blue-700" />
                  <h2 className="font-semibold text-slate-950">区域资源概览</h2>
                </div>
              </div>

              {governanceDistrictRows.length === 0 ? (
                <div className="px-5 py-8 text-sm text-slate-500">暂无正式停车场区域数据</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {governanceDistrictRows.map((district) => {
                    const occupancy = Number(district.occupancy_rate ?? district.occupancy ?? 0);
                    const total = district.total_slots ?? district.total;
                    const available = district.available_slots ?? district.available;
                    const lotsInDistrict = district.parking_lot_count ?? district.lots;

                    return (
                    <div key={district.district} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_120px_120px_120px] md:items-center">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">{district.district}</h3>
                        <p className="mt-1 text-xs text-slate-500">{lotsInDistrict} 个正式停车场</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">{total}</p>
                        <p className="text-xs text-slate-500">总车位</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-emerald-700">{available}</p>
                        <p className="text-xs text-slate-500">剩余车位</p>
                      </div>
                      <span className={`w-fit rounded-full border px-2 py-1 text-xs font-medium ${getOccupancyTone(occupancy)}`}>
                        占用 {occupancy}%
                      </span>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-5">
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-2">
                  <ExclamationTriangleIcon className="h-5 w-5 text-amber-700" />
                  <h2 className="font-semibold text-slate-950">治理观察</h2>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {observations.map((item) => (
                  <article key={item.title} className="px-5 py-4">
                    <h3 className="text-sm font-semibold text-slate-950">{item.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-2">
                  <ChartBarIcon className="h-5 w-5 text-blue-700" />
                  <h2 className="font-semibold text-slate-950">核心数据源状态</h2>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {p0Sources.length === 0 ? (
                  <div className="px-5 py-8 text-sm text-slate-500">暂无 P0 数据源</div>
                ) : (
                  p0Sources.map((source) => (
                    <article key={source.source_key} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-950">{source.name}</h3>
                          <p className="mt-1 text-xs text-slate-500">{source.source_key}</p>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {source.latest_import_status || '未导入'}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{source.next_action || '暂无下一步动作'}</p>
                    </article>
                  ))
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-2">
                  <MapPinIcon className="h-5 w-5 text-blue-700" />
                  <h2 className="font-semibold text-slate-950">候选点核验队列</h2>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  已剔除 {rejectedCandidates} 个候选点，剔除项不会显示在散点视图中。
                </p>
              </div>
              <div className="border-b border-slate-100 px-5 py-3">
                <div className="space-y-3">
                  <select
                    value={candidateReviewFilter}
                    onChange={(event) => {
                      setCandidateReviewFilter(event.target.value);
                      setSelectedCandidateIds([]);
                    }}
                    className="form-input"
                  >
                    <option value="active">有效候选</option>
                    <option value="candidate">待核验</option>
                    <option value="shortlisted">重点关注</option>
                    <option value="linked">已关联</option>
                    <option value="rejected">已剔除</option>
                  </select>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={toggleVisibleCandidateSelection}
                      className="rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50"
                    >
                      {visibleCandidateIds.length > 0 && visibleCandidateIds.every((id) => selectedCandidateIds.includes(id)) ? '取消本页' : '选择本页'}
                    </button>
                    <button
                      type="button"
                      disabled={bulkSaving || selectedCandidateRows.length === 0}
                      onClick={() => handleBulkCandidateReview('shortlisted')}
                      className="rounded-md border border-blue-200 px-2 py-1 font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      批量待调研
                    </button>
                    <button
                      type="button"
                      disabled={bulkSaving || selectedCandidateRows.length === 0}
                      onClick={() => handleBulkCandidateReview('rejected')}
                      className="rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      批量剔除
                    </button>
                    <span className="text-slate-500">已选 {selectedCandidateRows.length} 个</span>
                  </div>
                </div>
              </div>
              {candidateReviewQueue.length === 0 ? (
                <div className="px-5 py-8 text-sm text-slate-500">暂无候选点</div>
              ) : (
                <div className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
                  {candidateReviewQueue.slice(0, 12).map((candidate) => {
                    const currentLinkValue = candidateLinks[candidate.id] || '';
                    const isSaving = savingCandidateId === candidate.id;

                    return (
                      <article key={candidate.id} className="px-5 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-2">
                            <input
                              type="checkbox"
                              checked={selectedCandidateIds.includes(candidate.id)}
                              onChange={() => toggleCandidateSelection(candidate.id)}
                              className="mt-0.5 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                            />
                            <div className="min-w-0">
                              <h3 className="text-sm font-semibold text-slate-950">{candidate.name || candidate.external_id}</h3>
                              <p className="mt-1 text-xs text-slate-500">{candidate.external_id}</p>
                            </div>
                          </div>
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getCandidateReviewClassName(candidate.review_status)}`}>
                            {candidateReviewLabels[candidate.review_status] || candidate.review_status || '待核验'}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {formatCoordinate(candidate.latitude)}, {formatCoordinate(candidate.longitude)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          access: {candidate.access || '未知'} · fee: {candidate.fee || '未知'} · capacity: {candidate.capacity ?? '未知'}
                        </p>

                        <div className="mt-3 space-y-2">
                          <select
                            value={currentLinkValue}
                            onChange={(event) => handleCandidateLinkChange(candidate.id, event.target.value)}
                            className="form-input"
                          >
                            <option value="">选择正式停车场</option>
                            {lots.map((lot) => (
                              <option key={lot.id} value={lot.id}>
                                {lot.name}
                              </option>
                            ))}
                          </select>
                          {candidate.linked_parking_lot_name && (
                            <p className="text-xs text-emerald-700">已关联：{candidate.linked_parking_lot_name}</p>
                          )}
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleCandidateReview(candidate, 'shortlisted')}
                            className="rounded-md border border-blue-200 px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                          >
                            关注
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleCandidateReview(candidate, 'linked')}
                            className="rounded-md border border-emerald-200 px-2 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            关联
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleCandidateReview(candidate, 'rejected')}
                            className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            剔除
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </section>
        </>
      )}
    </div>
  );
};

export default AdminGovernanceOverview;
