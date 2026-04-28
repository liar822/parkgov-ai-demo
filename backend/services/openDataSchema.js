async function ensureOpenDataTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS data_sources (
      id SERIAL PRIMARY KEY,
      source_key VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      provider VARCHAR(255),
      category VARCHAR(100),
      priority VARCHAR(20),
      access_method TEXT,
      license_or_terms TEXT,
      primary_fields TEXT,
      fit_for_project TEXT,
      next_action TEXT,
      official_url TEXT,
      requires_key BOOLEAN DEFAULT false,
      metadata JSONB,
      notes TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    ALTER TABLE data_sources
      ADD COLUMN IF NOT EXISTS priority VARCHAR(20),
      ADD COLUMN IF NOT EXISTS primary_fields TEXT,
      ADD COLUMN IF NOT EXISTS fit_for_project TEXT,
      ADD COLUMN IF NOT EXISTS next_action TEXT,
      ADD COLUMN IF NOT EXISTS metadata JSONB
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS open_data_import_jobs (
      id SERIAL PRIMARY KEY,
      data_source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      source_key VARCHAR(100) NOT NULL,
      import_kind VARCHAR(100) NOT NULL,
      input_file TEXT,
      file_sha256 VARCHAR(64),
      status VARCHAR(50) DEFAULT 'running',
      dry_run BOOLEAN DEFAULT false,
      records_seen INTEGER DEFAULT 0,
      records_imported INTEGER DEFAULT 0,
      records_failed INTEGER DEFAULT 0,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      error_message TEXT,
      metadata JSONB
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS parking_lot_external_refs (
      id SERIAL PRIMARY KEY,
      parking_lot_id INTEGER REFERENCES parking_lots(id) ON DELETE CASCADE,
      data_source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      source_key VARCHAR(100) NOT NULL,
      external_id VARCHAR(255) NOT NULL,
      external_name VARCHAR(255),
      metadata JSONB,
      first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_key, external_id)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS parking_occupancy_snapshots (
      id SERIAL PRIMARY KEY,
      parking_lot_id INTEGER REFERENCES parking_lots(id) ON DELETE CASCADE,
      data_source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      source_key VARCHAR(100) NOT NULL,
      external_id VARCHAR(255),
      total_spaces INTEGER,
      available_spaces INTEGER,
      occupied_spaces INTEGER,
      availability_level VARCHAR(100),
      observed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS parking_lot_candidates (
      id SERIAL PRIMARY KEY,
      data_source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      source_key VARCHAR(100) NOT NULL,
      external_id VARCHAR(255) NOT NULL,
      osm_type VARCHAR(30),
      osm_id BIGINT,
      name VARCHAR(255),
      latitude DECIMAL(11,8),
      longitude DECIMAL(11,8),
      parking_type VARCHAR(100),
      access VARCHAR(100),
      fee VARCHAR(100),
      capacity INTEGER,
      operator VARCHAR(255),
      tags JSONB,
      metadata JSONB,
      review_status VARCHAR(50) DEFAULT 'candidate',
      review_notes TEXT,
      linked_parking_lot_id INTEGER REFERENCES parking_lots(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP,
      review_metadata JSONB,
      is_active BOOLEAN DEFAULT true,
      first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_key, external_id)
    )
  `);

  await client.query(`
    ALTER TABLE parking_lot_candidates
      ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'candidate',
      ADD COLUMN IF NOT EXISTS review_notes TEXT,
      ADD COLUMN IF NOT EXISTS linked_parking_lot_id INTEGER REFERENCES parking_lots(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS review_metadata JSONB
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_data_sources_key ON data_sources(source_key);
    CREATE INDEX IF NOT EXISTS idx_import_jobs_source ON open_data_import_jobs(source_key);
    CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON open_data_import_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_external_refs_lot ON parking_lot_external_refs(parking_lot_id);
    CREATE INDEX IF NOT EXISTS idx_external_refs_source ON parking_lot_external_refs(source_key, external_id);
    CREATE INDEX IF NOT EXISTS idx_occupancy_snapshots_lot_time ON parking_occupancy_snapshots(parking_lot_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_occupancy_snapshots_source_time ON parking_occupancy_snapshots(source_key, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_parking_lot_candidates_source ON parking_lot_candidates(source_key);
    CREATE INDEX IF NOT EXISTS idx_parking_lot_candidates_review ON parking_lot_candidates(review_status);
    CREATE INDEX IF NOT EXISTS idx_parking_lot_candidates_linked_lot ON parking_lot_candidates(linked_parking_lot_id);
    CREATE INDEX IF NOT EXISTS idx_parking_lot_candidates_location ON parking_lot_candidates(latitude, longitude);
    CREATE INDEX IF NOT EXISTS idx_parking_lot_candidates_seen ON parking_lot_candidates(last_seen_at DESC);
  `);
}

module.exports = {
  ensureOpenDataTables
};
