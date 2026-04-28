class ParkingSlotRoiService {
  static async ensureParkingSlotRoisTable(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS parking_slot_rois (
        id SERIAL PRIMARY KEY,
        parking_lot_id INTEGER REFERENCES parking_lots(id) ON DELETE CASCADE,
        parking_slot_id INTEGER REFERENCES parking_slots(id) ON DELETE CASCADE,
        camera_source_id INTEGER REFERENCES camera_sources(id) ON DELETE SET NULL,
        roi_version VARCHAR(100) NOT NULL DEFAULT 'demo_v1',
        coordinate_space VARCHAR(50) DEFAULT 'pixel',
        x DECIMAL(12,4) NOT NULL,
        y DECIMAL(12,4) NOT NULL,
        width DECIMAL(12,4) NOT NULL,
        height DECIMAL(12,4) NOT NULL,
        frame_width INTEGER,
        frame_height INTEGER,
        source_type VARCHAR(100) DEFAULT 'roi_csv',
        source_file TEXT,
        metadata JSONB,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(parking_slot_id, camera_source_id, roi_version)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_parking_slot_rois_lot ON parking_slot_rois(parking_lot_id);
      CREATE INDEX IF NOT EXISTS idx_parking_slot_rois_slot ON parking_slot_rois(parking_slot_id);
      CREATE INDEX IF NOT EXISTS idx_parking_slot_rois_camera ON parking_slot_rois(camera_source_id);
      CREATE INDEX IF NOT EXISTS idx_parking_slot_rois_active ON parking_slot_rois(is_active);
    `);
  }

  static async resolveCameraSourceId(client, cameraExternalId) {
    if (!cameraExternalId) {
      return null;
    }

    const result = await client.query(
      'SELECT id FROM camera_sources WHERE camera_external_id = $1 LIMIT 1',
      [cameraExternalId]
    );
    return result.rows[0]?.id || null;
  }

  static async upsertSlotRoi(client, value) {
    await ParkingSlotRoiService.ensureParkingSlotRoisTable(client);

    const cameraSourceId = value.cameraSourceId
      || await ParkingSlotRoiService.resolveCameraSourceId(client, value.cameraExternalId);
    const metadata = {
      ...(value.metadata || {}),
      camera_external_id: value.cameraExternalId || null,
      notes: value.notes || null
    };

    const result = await client.query(
      `INSERT INTO parking_slot_rois (
         parking_lot_id,
         parking_slot_id,
         camera_source_id,
         roi_version,
         coordinate_space,
         x,
         y,
         width,
         height,
         frame_width,
         frame_height,
         source_type,
         source_file,
         metadata,
         is_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true)
       ON CONFLICT (parking_slot_id, camera_source_id, roi_version)
       DO UPDATE SET
         parking_lot_id = EXCLUDED.parking_lot_id,
         coordinate_space = EXCLUDED.coordinate_space,
         x = EXCLUDED.x,
         y = EXCLUDED.y,
         width = EXCLUDED.width,
         height = EXCLUDED.height,
         frame_width = EXCLUDED.frame_width,
         frame_height = EXCLUDED.frame_height,
         source_type = EXCLUDED.source_type,
         source_file = EXCLUDED.source_file,
         metadata = COALESCE(parking_slot_rois.metadata, '{}'::jsonb) || EXCLUDED.metadata,
         is_active = true,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        value.parkingLotId,
        value.parkingSlotId,
        cameraSourceId,
        value.roiVersion || 'demo_v1',
        value.coordinateSpace || 'pixel',
        value.x,
        value.y,
        value.width,
        value.height,
        value.frameWidth || null,
        value.frameHeight || null,
        value.sourceType || 'roi_csv',
        value.sourceFile || null,
        JSON.stringify(metadata)
      ]
    );

    return result.rows[0];
  }

  static async listActiveRoisForLot(client, filters = {}) {
    await ParkingSlotRoiService.ensureParkingSlotRoisTable(client);

    const params = [filters.parkingLotId];
    const where = ['psr.parking_lot_id = $1', 'psr.is_active = true'];

    if (filters.cameraExternalId) {
      params.push(filters.cameraExternalId);
      where.push(`cs.camera_external_id = $${params.length}`);
    }

    if (filters.roiVersion) {
      params.push(filters.roiVersion);
      where.push(`psr.roi_version = $${params.length}`);
    }

    const result = await client.query(
      `SELECT
         psr.*,
         ps.slot_number,
         cs.camera_external_id,
         cs.name AS camera_name,
         cs.source_kind
       FROM parking_slot_rois psr
       JOIN parking_slots ps ON ps.id = psr.parking_slot_id
       LEFT JOIN camera_sources cs ON cs.id = psr.camera_source_id
       WHERE ${where.join(' AND ')}
       ORDER BY ps.slot_number ASC, psr.id ASC`,
      params
    );

    return result.rows;
  }
}

module.exports = ParkingSlotRoiService;
