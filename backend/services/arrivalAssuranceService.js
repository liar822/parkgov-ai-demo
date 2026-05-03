const crypto = require('crypto');
const db = require('../config/database');

const DEFAULT_REFERENCE = {
  name: '北京高校试点参考点',
  latitude: 39.9929,
  longitude: 116.3103
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const getMetadata = (lot) => lot?.slot_configuration?.metadata || {};

const normalizeStatus = (status) => {
  if (!status) return null;
  return ['active', 'expired', 'cancelled'].includes(status) ? status : null;
};

const getDistanceKm = (from, to) => {
  if (!from || !to || to.latitude === null || to.longitude === null) return null;

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

const getAgeHours = (timestamp) => {
  if (!timestamp) return null;
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (Date.now() - time) / (60 * 60 * 1000));
};

const getFreshnessScore = (ageHours) => {
  if (ageHours === null) return 30;
  if (ageHours <= 1) return 100;
  if (ageHours <= 6) return 85;
  if (ageHours <= 24) return 65;
  if (ageHours <= 72) return 45;
  return 25;
};

const getRisk = (probability, lot) => {
  if (lot.source_type === 'ai_dataset_demo') {
    return {
      level: 'demo_only',
      label: '仅供验证',
      description: '公开数据集结果适合展示 AI 链路，不建议作为真实出行目标。'
    };
  }
  if (lot.latitude === null || lot.longitude === null) {
    return {
      level: 'coordinate_missing',
      label: '坐标待核验',
      description: '该停车场缺少可导航坐标，到场前需要人工核验位置。'
    };
  }
  if (lot.available_slots <= 0 || lot.occupancy_rate >= 95 || probability < 35) {
    return {
      level: 'high',
      label: '高风险',
      description: '余位或数据条件不足，到场后继续寻找车位的风险较高。'
    };
  }
  if (lot.occupancy_rate >= 75 || probability < 62) {
    return {
      level: 'medium',
      label: '需备选',
      description: '可以作为目标，但建议同时保留一个余位更稳的备选停车场。'
    };
  }
  return {
    level: 'low',
    label: '较稳妥',
    description: '余位、距离和数据状态相对完整，适合作为当前优先目标。'
  };
};

const getDecisionStatus = (risk) => {
  if (risk?.level === 'demo_only') return 'demo_only';
  if (risk?.level === 'coordinate_missing') return 'coordinate_missing';
  if (risk?.level === 'high' || risk?.level === 'medium') return 'keep_backup';
  return 'go_now';
};

const buildSwitchRecommendation = (intent, currentAssurance, alternatives = []) => {
  const snapshot = intent?.lot_snapshot || {};
  const availableDelta = Number(currentAssurance?.available_slots ?? 0) - Number(snapshot.available_slots ?? 0);
  const probabilityDelta = Number(currentAssurance?.probability ?? 0) - Number(snapshot.probability ?? 0);
  const bestAlternative = alternatives[0] || null;
  const shouldSwitch = Boolean(
    currentAssurance?.risk?.level === 'high'
      || currentAssurance?.risk?.level === 'coordinate_missing'
      || availableDelta <= -8
      || probabilityDelta <= -18
      || (bestAlternative && Number(bestAlternative.probability || 0) >= Number(currentAssurance?.probability || 0) + 12)
  );

  return {
    should_switch: shouldSwitch,
    level: shouldSwitch ? 'warning' : 'normal',
    suggested_lot: bestAlternative,
    reason: shouldSwitch
      ? '当前目的地余位、风险或备选优势发生变化，建议先查看 Plan B。'
      : '当前到场风险未明显升高，可继续按演示计划前往。'
  };
};

const buildAssurance = (row, reference) => {
  const metadata = getMetadata(row);
  const latitude = toNumber(metadata.latitude);
  const longitude = toNumber(metadata.longitude);
  const totalSlots = Number(row.total_slots || row.configured_total_slots || 0);
  const occupiedSlots = Number(row.occupied_slots || 0);
  const availableSlots = Math.max(Number(row.available_slots || totalSlots - occupiedSlots || 0), 0);
  const occupancyRate = totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 1000) / 10 : 0;
  const distanceKm = getDistanceKm(reference, { latitude, longitude });
  const etaMinutes = distanceKm === null ? null : Math.max(3, Math.round((distanceKm / 18) * 60 + 3));
  const dataTimestamp = row.latest_inference_at || row.latest_open_data_observed_at || metadata.imported_at || row.updated_at || row.created_at;
  const dataAgeHours = getAgeHours(dataTimestamp);
  const freshnessScore = getFreshnessScore(dataAgeHours);
  const roiCoverageRate = Number(row.roi_coverage_rate || 0);
  const latestConfidence = row.latest_inference_average_confidence !== null && row.latest_inference_average_confidence !== undefined
    ? Number(row.latest_inference_average_confidence) * 100
    : null;
  const sourceType = metadata.source_type || 'demo';

  const availabilityScore = totalSlots > 0
    ? clamp((availableSlots / totalSlots) * 100 + Math.min(availableSlots, 25), 0, 100)
    : 20;
  const distanceScore = distanceKm === null ? 35 : clamp(100 - Math.min(distanceKm, 12) * 7, 0, 100);
  const aiScore = clamp(
    (roiCoverageRate * 0.45)
      + (row.latest_inference_at ? 35 : 0)
      + (latestConfidence !== null ? latestConfidence * 0.2 : 0),
    0,
    100
  );

  let probability = availabilityScore * 0.42 + distanceScore * 0.2 + freshnessScore * 0.23 + aiScore * 0.15;
  if (!metadata.fee_rule) probability -= 4;
  if (latitude === null || longitude === null) probability -= 12;
  if (sourceType === 'ai_dataset_demo') probability -= 28;
  if (occupancyRate >= 90) probability -= 14;
  probability = Math.round(clamp(probability, 5, 98));

  const normalizedLot = {
    id: row.id,
    name: row.name,
    total_slots: totalSlots,
    video_url: row.video_url,
    slot_configuration: row.slot_configuration,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata,
    latitude,
    longitude,
    source_type: sourceType,
    statistics: {
      total_slots: totalSlots,
      occupied_slots: occupiedSlots,
      available_slots: availableSlots,
      occupancy_rate: occupancyRate
    },
    available_slots: availableSlots,
    occupancy_rate: occupancyRate,
    distance_km: distanceKm,
    eta_minutes: etaMinutes,
    data_timestamp: dataTimestamp,
    data_age_hours: dataAgeHours === null ? null : Math.round(dataAgeHours * 10) / 10,
    freshness_score: freshnessScore,
    ai_confidence_score: Math.round(aiScore),
    roi_coverage_rate: Math.round(roiCoverageRate * 10) / 10,
    camera_source_count: Number(row.camera_source_count || 0),
    latest_inference_event_id: row.latest_inference_event_id,
    latest_inference_at: row.latest_inference_at,
    latest_open_data_observed_at: row.latest_open_data_observed_at,
    probability,
    risk: null,
    reason: ''
  };

  normalizedLot.risk = getRisk(probability, normalizedLot);
  normalizedLot.decision_status = getDecisionStatus(normalizedLot.risk);
  normalizedLot.assurance_breakdown = {
    availability: {
      label: '余位保障',
      score: Math.round(availabilityScore),
      detail: `${availableSlots}/${totalSlots} 个余位`
    },
    distance: {
      label: '距离便利',
      score: Math.round(distanceScore),
      detail: distanceKm === null ? '坐标待核验' : `约 ${etaMinutes} 分钟可达`
    },
    freshness: {
      label: '数据新鲜度',
      score: Math.round(freshnessScore),
      detail: dataAgeHours === null ? '暂无更新时间' : `${Math.round(dataAgeHours * 10) / 10} 小时前更新`
    },
    ai_trust: {
      label: 'AI 可信度',
      score: Math.round(aiScore),
      detail: row.latest_inference_at ? `ROI ${Math.round(roiCoverageRate * 10) / 10}%` : '等待 AI 识别事件'
    },
    fee: {
      label: '收费完整度',
      score: metadata.fee_rule ? 100 : 35,
      detail: metadata.fee_rule ? '收费规则已标注' : '收费待补充'
    }
  };
  normalizedLot.reason = [
    `预计可停概率 ${probability}%`,
    `${availableSlots}/${totalSlots} 个余位`,
    distanceKm === null ? '坐标待核验' : `约 ${etaMinutes} 分钟可达`,
    dataAgeHours === null ? '暂无更新时间' : `数据约 ${normalizedLot.data_age_hours} 小时前更新`
  ].join('，');

  return normalizedLot;
};

class ArrivalAssuranceService {
  static async ensureArrivalIntentsTable(client = db) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS arrival_intents (
        id SERIAL PRIMARY KEY,
        display_code VARCHAR(64) UNIQUE NOT NULL,
        parking_lot_id INTEGER REFERENCES parking_lots(id) ON DELETE SET NULL,
        estimated_arrival_minutes INTEGER NOT NULL,
        expected_duration_minutes INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
        lot_snapshot JSONB NOT NULL,
        reference_location JSONB DEFAULT '{}'::jsonb,
        metadata JSONB DEFAULT '{}'::jsonb,
        disclaimer TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      ALTER TABLE arrival_intents
        ADD COLUMN IF NOT EXISTS reference_location JSONB DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_arrival_intents_lot_id ON arrival_intents(parking_lot_id);
      CREATE INDEX IF NOT EXISTS idx_arrival_intents_status ON arrival_intents(status);
      CREATE INDEX IF NOT EXISTS idx_arrival_intents_expires_at ON arrival_intents(expires_at);
    `);
  }

  static async expireStaleArrivalIntents(client = db) {
    await ArrivalAssuranceService.ensureArrivalIntentsTable(client);

    const result = await client.query(`
      UPDATE arrival_intents
      SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'active'
        AND expires_at <= CURRENT_TIMESTAMP
      RETURNING id, display_code, parking_lot_id, expires_at
    `);

    return {
      expired_count: result.rowCount,
      expired_intents: result.rows
    };
  }

  static normalizeArrivalIntent(row) {
    if (!row) return null;

    return {
      arrival_intent_id: row.id,
      display_code: row.display_code,
      parking_lot_id: row.parking_lot_id,
      parking_lot_name: row.parking_lot_name || row.lot_snapshot?.name || null,
      estimated_arrival_minutes: row.estimated_arrival_minutes,
      expected_duration_minutes: row.expected_duration_minutes,
      status: row.status,
      lot_snapshot: row.lot_snapshot,
      reference_location: row.reference_location || {},
      metadata: row.metadata || {},
      disclaimer: row.disclaimer,
      expires_at: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
    };
  }

  static async getRecommendationRows() {
    const result = await db.query(`
      SELECT
        pl.id,
        pl.name,
        pl.total_slots AS configured_total_slots,
        pl.video_url,
        pl.slot_configuration,
        pl.is_active,
        pl.created_at,
        pl.updated_at,
        COALESCE(slot_stats.total_slots, 0)::INTEGER AS total_slots,
        COALESCE(slot_stats.occupied_slots, 0)::INTEGER AS occupied_slots,
        GREATEST(COALESCE(slot_stats.total_slots, pl.total_slots, 0) - COALESCE(slot_stats.occupied_slots, 0), 0)::INTEGER AS available_slots,
        COALESCE(roi_stats.roi_coverage_rate, 0)::NUMERIC AS roi_coverage_rate,
        COALESCE(camera_stats.camera_source_count, 0)::INTEGER AS camera_source_count,
        latest_inference.id AS latest_inference_event_id,
        latest_inference.created_at AS latest_inference_at,
        latest_inference.average_confidence AS latest_inference_average_confidence,
        latest_snapshot.observed_at AS latest_open_data_observed_at
      FROM parking_lots pl
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_slots,
          COUNT(*) FILTER (WHERE ps.is_occupied = true) AS occupied_slots
        FROM parking_slots ps
        WHERE ps.parking_lot_id = pl.id
      ) slot_stats ON true
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN COALESCE(slot_stats.total_slots, pl.total_slots, 0) > 0
              THEN ROUND((COUNT(DISTINCT psr.parking_slot_id)::NUMERIC / COALESCE(slot_stats.total_slots, pl.total_slots, 1)::NUMERIC) * 100, 2)
            ELSE 0
          END AS roi_coverage_rate
        FROM parking_slot_rois psr
        WHERE psr.parking_lot_id = pl.id
          AND psr.is_active = true
      ) roi_stats ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE cs.is_active = true)::INTEGER AS camera_source_count
        FROM camera_sources cs
        WHERE cs.parking_lot_id = pl.id
      ) camera_stats ON true
      LEFT JOIN LATERAL (
        SELECT *
        FROM inference_events ie
        WHERE ie.parking_lot_id = pl.id
        ORDER BY ie.created_at DESC, ie.id DESC
        LIMIT 1
      ) latest_inference ON true
      LEFT JOIN LATERAL (
        SELECT *
        FROM parking_occupancy_snapshots snapshots
        WHERE snapshots.parking_lot_id = pl.id
        ORDER BY snapshots.observed_at DESC, snapshots.id DESC
        LIMIT 1
      ) latest_snapshot ON true
      WHERE pl.is_active = true
    `);

    return result.rows;
  }

  static async getRecommendations(options = {}) {
    const reference = {
      ...DEFAULT_REFERENCE,
      latitude: toNumber(options.reference_lat) ?? DEFAULT_REFERENCE.latitude,
      longitude: toNumber(options.reference_lng) ?? DEFAULT_REFERENCE.longitude
    };
    const limit = clamp(Number(options.limit || 10), 1, 50);
    const rows = await ArrivalAssuranceService.getRecommendationRows();
    const recommendations = rows
      .map((row) => buildAssurance(row, reference))
      .sort((first, second) => (
        second.probability - first.probability
        || second.available_slots - first.available_slots
        || (first.distance_km ?? 9999) - (second.distance_km ?? 9999)
      ));

    return {
      reference,
      recommendations: recommendations.slice(0, limit).map((lot, index) => ({
        ...lot,
        rank: index + 1,
        alternatives: recommendations
          .filter((candidate) => candidate.id !== lot.id)
          .slice(0, 2)
          .map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            probability: candidate.probability,
            risk: candidate.risk,
            available_slots: candidate.available_slots,
            distance_km: candidate.distance_km,
            eta_minutes: candidate.eta_minutes,
            decision_status: candidate.decision_status
          }))
      })),
      backup_lots: recommendations.slice(1, 4),
      generated_at: new Date().toISOString()
    };
  }

  static async createArrivalIntent(payload) {
    const client = await db.getClient();

    try {
      await client.query('BEGIN');
      await ArrivalAssuranceService.ensureArrivalIntentsTable(client);

      const lotId = Number(payload.lot_id);
      const estimatedArrivalMinutes = clamp(Number(payload.estimated_arrival_minutes || 15), 1, 240);
      const expectedDurationMinutes = clamp(Number(payload.expected_duration_minutes || 120), 15, 1440);
      const reference = {
        ...DEFAULT_REFERENCE,
        latitude: toNumber(payload.reference_lat) ?? DEFAULT_REFERENCE.latitude,
        longitude: toNumber(payload.reference_lng) ?? DEFAULT_REFERENCE.longitude
      };

      const lotResult = await client.query('SELECT * FROM parking_lots WHERE id = $1 AND is_active = true', [lotId]);
      if (lotResult.rows.length === 0) {
        const error = new Error('Parking lot not found');
        error.statusCode = 404;
        throw error;
      }

      const recommendationRows = await ArrivalAssuranceService.getRecommendationRows();
      const row = recommendationRows.find((item) => Number(item.id) === lotId);
      const lotSnapshot = buildAssurance(row || lotResult.rows[0], reference);
      const displayCode = `PG-ARR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const expiresAt = new Date(Date.now() + Math.max(estimatedArrivalMinutes + 30, 45) * 60 * 1000);
      const disclaimer = '演示到场计划：不锁定车位、不创建真实预约、不产生扣款，仅用于展示到场保障流程。';

      const insertResult = await client.query(
        `INSERT INTO arrival_intents (
           display_code,
           parking_lot_id,
           estimated_arrival_minutes,
           expected_duration_minutes,
           lot_snapshot,
           reference_location,
           metadata,
           disclaimer,
           expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          displayCode,
          lotId,
          estimatedArrivalMinutes,
          expectedDurationMinutes,
          JSON.stringify(lotSnapshot),
          JSON.stringify(reference),
          JSON.stringify({
            source: 'parking_service_frontend',
            capability: 'arrival_assurance_demo',
            created_from: payload.created_from || 'api'
          }),
          disclaimer,
          expiresAt
        ]
      );

      await client.query('COMMIT');

      return {
        arrival_intent_id: insertResult.rows[0].id,
        display_code: displayCode,
        parking_lot_id: lotId,
        estimated_arrival_minutes: estimatedArrivalMinutes,
        expected_duration_minutes: expectedDurationMinutes,
        expires_at: expiresAt.toISOString(),
        status: insertResult.rows[0].status,
        lot_snapshot: lotSnapshot,
        reference_location: reference,
        metadata: insertResult.rows[0].metadata || {},
        disclaimer
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async enrichArrivalIntent(normalizedIntent) {
    if (!normalizedIntent?.parking_lot_id) {
      return normalizedIntent;
    }

    const reference = normalizedIntent.reference_location && typeof normalizedIntent.reference_location === 'object'
      ? normalizedIntent.reference_location
      : {};
    const recommendationData = await ArrivalAssuranceService.getRecommendations({
      reference_lat: reference.latitude,
      reference_lng: reference.longitude,
      limit: 50
    });
    const currentAssurance = recommendationData.recommendations.find((lot) => Number(lot.id) === Number(normalizedIntent.parking_lot_id)) || null;
    const alternatives = recommendationData.recommendations
      .filter((lot) => Number(lot.id) !== Number(normalizedIntent.parking_lot_id))
      .slice(0, 2)
      .map((lot) => ({
        id: lot.id,
        name: lot.name,
        probability: lot.probability,
        risk: lot.risk,
        available_slots: lot.available_slots,
        distance_km: lot.distance_km,
        eta_minutes: lot.eta_minutes,
        decision_status: lot.decision_status
      }));
    const snapshot = normalizedIntent.lot_snapshot || {};
    const snapshotDelta = currentAssurance ? {
      available_slots_delta: Number(currentAssurance.available_slots || 0) - Number(snapshot.available_slots || 0),
      probability_delta: Number(currentAssurance.probability || 0) - Number(snapshot.probability || 0),
      occupancy_rate_delta: Number(currentAssurance.occupancy_rate || 0) - Number(snapshot.occupancy_rate || 0),
      generated_available_slots: snapshot.available_slots ?? null,
      current_available_slots: currentAssurance.available_slots ?? null
    } : null;

    return {
      ...normalizedIntent,
      current_assurance: currentAssurance,
      snapshot_delta: snapshotDelta,
      switch_recommendation: buildSwitchRecommendation(normalizedIntent, currentAssurance, alternatives),
      alternatives
    };
  }

  static async getArrivalIntentByCode(displayCode) {
    await ArrivalAssuranceService.expireStaleArrivalIntents();

    const result = await db.query(
      `SELECT
         ai.*,
         pl.name AS parking_lot_name
       FROM arrival_intents ai
       LEFT JOIN parking_lots pl ON pl.id = ai.parking_lot_id
       WHERE ai.display_code = $1
       LIMIT 1`,
      [displayCode]
    );

    if (result.rows.length === 0) {
      const error = new Error('Arrival intent not found');
      error.statusCode = 404;
      throw error;
    }

    return ArrivalAssuranceService.enrichArrivalIntent(ArrivalAssuranceService.normalizeArrivalIntent(result.rows[0]));
  }

  static async listArrivalIntents(options = {}) {
    await ArrivalAssuranceService.expireStaleArrivalIntents();

    const limit = clamp(Number(options.limit || 20), 1, 100);
    const offset = Math.max(Number(options.offset || 0), 0);
    const status = normalizeStatus(options.status);
    const lotId = toNumber(options.lot_id);
    const queryParams = [];
    const whereClauses = [];

    if (status) {
      queryParams.push(status);
      whereClauses.push(`ai.status = $${queryParams.length}`);
    }

    if (lotId !== null) {
      queryParams.push(lotId);
      whereClauses.push(`ai.parking_lot_id = $${queryParams.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    queryParams.push(limit, offset);

    const result = await db.query(
      `SELECT
         ai.*,
         pl.name AS parking_lot_name
       FROM arrival_intents ai
       LEFT JOIN parking_lots pl ON pl.id = ai.parking_lot_id
       ${whereSql}
       ORDER BY ai.created_at DESC, ai.id DESC
       LIMIT $${queryParams.length - 1}
       OFFSET $${queryParams.length}`,
      queryParams
    );

    const countResult = await db.query(
      `SELECT
         COUNT(*)::INTEGER AS total,
         COUNT(*) FILTER (WHERE status = 'active')::INTEGER AS active,
         COUNT(*) FILTER (WHERE status = 'expired')::INTEGER AS expired,
         COUNT(*) FILTER (WHERE status = 'cancelled')::INTEGER AS cancelled
       FROM arrival_intents ai
       ${whereSql}`,
      queryParams.slice(0, queryParams.length - 2)
    );

    const arrivalIntents = await Promise.all(
      result.rows
        .map(ArrivalAssuranceService.normalizeArrivalIntent)
        .map((intent) => ArrivalAssuranceService.enrichArrivalIntent(intent))
    );

    return {
      arrival_intents: arrivalIntents,
      pagination: {
        limit,
        offset,
        count: result.rows.length,
        total: Number(countResult.rows[0]?.total || 0)
      },
      summary: {
        total: Number(countResult.rows[0]?.total || 0),
        active: Number(countResult.rows[0]?.active || 0),
        expired: Number(countResult.rows[0]?.expired || 0),
        cancelled: Number(countResult.rows[0]?.cancelled || 0)
      }
    };
  }
}

module.exports = ArrivalAssuranceService;
