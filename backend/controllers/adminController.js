const ParkingLot = require('../models/ParkingLot');
const ParkingSlot = require('../models/ParkingSlot');
const VideoAnalysis = require('../models/VideoAnalysis');
const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const InferenceEventService = require('../services/inferenceEventService');
const AiProcessingJobService = require('../services/aiProcessingJobService');
const { ensureOpenDataTables } = require('../services/openDataSchema');
const ParkingSlotRoiService = require('../services/parkingSlotRoiService');
const DemoAiRunService = require('../services/demoAiRunService');
const DemoAiInferenceService = require('../services/demoAiInferenceService');
const ArrivalAssuranceService = require('../services/arrivalAssuranceService');

// Validation schemas
const createLotSchema = Joi.object({
  name: Joi.string().min(3).max(255).required(),
  total_slots: Joi.number().integer().min(1).max(1000).required(),
  video_url: Joi.string().uri().optional(),
  slot_configuration: Joi.object({
    rows: Joi.number().integer().min(1).required(),
    columns: Joi.number().integer().min(1).required(),
    slot_width: Joi.number().min(1).optional(),
    slot_height: Joi.number().min(1).optional()
  }).required()
});

const updateLotSchema = Joi.object({
  name: Joi.string().min(3).max(255).optional(),
  total_slots: Joi.number().integer().min(1).max(1000).optional(),
  video_url: Joi.string().uri().allow('').optional(),
  slot_configuration: Joi.object().optional(),
  is_active: Joi.boolean().optional()
});

const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required()
});

const createUserSchema = Joi.object({
  username: Joi.string().min(3).max(100).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid('admin', 'user').default('user')
});

const inferenceDetectionSchema = Joi.object({
  slot_id: Joi.number().integer().positive().optional(),
  slot_number: Joi.number().integer().positive().optional(),
  is_occupied: Joi.boolean().required(),
  confidence: Joi.number().min(0).max(1).optional(),
  predicted_vacancy_seconds: Joi.number().integer().min(0).optional()
}).or('slot_id', 'slot_number');

const inferenceEventSchema = Joi.object({
  camera_id: Joi.number().integer().positive().optional(),
  camera_external_id: Joi.string().optional(),
  parking_lot_id: Joi.number().integer().positive().optional(),
  parking_lot_source_id: Joi.string().optional(),
  processing_job_id: Joi.number().integer().positive().optional(),
  model_name: Joi.string().max(100).default('unknown'),
  input_path: Joi.string().allow('').optional(),
  inference_timestamp: Joi.date().iso().optional(),
  detections: Joi.array().items(inferenceDetectionSchema).min(1).required(),
  notes: Joi.string().allow('').optional()
}).or('camera_id', 'camera_external_id', 'parking_lot_id', 'parking_lot_source_id');

const aiProcessingJobSchema = Joi.object({
  parking_lot_id: Joi.number().integer().positive().optional(),
  camera_source_id: Joi.number().integer().positive().optional(),
  camera_external_id: Joi.string().trim().min(1).optional(),
  job_type: Joi.string().valid('image', 'video_file', 'dataset_batch', 'manual_demo', 'api_inference').default('api_inference'),
  input_path: Joi.string().allow('').optional(),
  model_name: Joi.string().max(100).allow('').optional(),
  status: Joi.string().valid('queued', 'processing', 'completed', 'failed', 'cancelled').default('queued'),
  progress_percent: Joi.number().integer().min(0).max(100).optional(),
  result_inference_event_id: Joi.number().integer().positive().optional(),
  error_message: Joi.string().allow('', null).optional(),
  metadata: Joi.object().optional(),
  notes: Joi.string().allow('', null).optional()
}).or('parking_lot_id', 'camera_source_id', 'camera_external_id');

const aiProcessingJobStatusSchema = Joi.object({
  status: Joi.string().valid('queued', 'processing', 'completed', 'failed', 'cancelled').required(),
  progress_percent: Joi.number().integer().min(0).max(100).optional(),
  result_inference_event_id: Joi.number().integer().positive().optional(),
  error_message: Joi.string().allow('', null).optional(),
  metadata: Joi.object().optional()
});

const candidateReviewSchema = Joi.object({
  review_status: Joi.string().valid('candidate', 'shortlisted', 'linked', 'rejected').required(),
  review_notes: Joi.string().allow('', null).optional(),
  linked_parking_lot_id: Joi.number().integer().positive().allow(null).optional()
});

const arrivalIntentQuerySchema = Joi.object({
  status: Joi.string().valid('active', 'expired', 'cancelled').optional(),
  lot_id: Joi.number().integer().positive().optional(),
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0)
});

class AdminController {
  // Admin authentication
  static async login(req, res) {
    try {
      const { error, value } = loginSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation error',
          details: error.details[0].message
        });
      }

      const { username, password } = value;

      // Find user
      const query = 'SELECT * FROM users WHERE username = $1 AND is_active = true';
      const result = await db.query(query, [username]);

      if (result.rows.length === 0) {
        return res.status(401).json({
          error: 'Invalid credentials'
        });
      }

      const user = result.rows[0];

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          error: 'Invalid credentials'
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        { 
          userId: user.id, 
          username: user.username, 
          role: user.role 
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role
          }
        }
      });
    } catch (error) {
      console.error('Error during login:', error);
      res.status(500).json({
        error: 'Login failed',
        message: error.message
      });
    }
  }

  static async getArrivalIntents(req, res) {
    try {
      const { error, value } = arrivalIntentQuerySchema.validate(req.query);
      if (error) {
        return res.status(400).json({
          error: 'Validation error',
          details: error.details[0].message
        });
      }

      const data = await ArrivalAssuranceService.listArrivalIntents(value);

      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error getting arrival intents:', error);
      res.status(500).json({
        error: 'Failed to get arrival intents',
        message: error.message
      });
    }
  }

  static async expireArrivalIntents(req, res) {
    try {
      const data = await ArrivalAssuranceService.expireStaleArrivalIntents();

      res.json({
        success: true,
        message: 'Expired stale arrival intents',
        data
      });
    } catch (error) {
      console.error('Error expiring arrival intents:', error);
      res.status(500).json({
        error: 'Failed to expire arrival intents',
        message: error.message
      });
    }
  }

  // Create new user
  static async createUser(req, res) {
    try {
      const { error, value } = createUserSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation error',
          details: error.details[0].message
        });
      }

      const { username, email, password, role } = value;

      // Check if user already exists
      const existingUser = await db.query(
        'SELECT id FROM users WHERE username = $1 OR email = $2',
        [username, email]
      );

      if (existingUser.rows.length > 0) {
        return res.status(409).json({
          error: 'User with this username or email already exists'
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const query = `
        INSERT INTO users (username, email, password_hash, role)
        VALUES ($1, $2, $3, $4)
        RETURNING id, username, email, role, created_at
      `;

      const result = await db.query(query, [username, email, hashedPassword, role]);
      const newUser = result.rows[0];

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: {
          user: newUser
        }
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({
        error: 'Failed to create user',
        message: error.message
      });
    }
  }

  // Create new parking lot
  static async createParkingLot(req, res) {
    try {
      const { error, value } = createLotSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation error',
          details: error.details[0].message
        });
      }

      const { name, total_slots, video_url, slot_configuration } = value;

      // Create parking lot
      const parkingLot = await ParkingLot.create({
        name,
        total_slots,
        video_url,
        slot_configuration
      });

      // Create parking slots based on configuration
      const { rows, columns } = slot_configuration;
      const slotWidth = slot_configuration.slot_width || 2.5;
      const slotHeight = slot_configuration.slot_height || 5.0;

      const slots = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const slotNumber = row * columns + col + 1;
          
          if (slotNumber <= total_slots) {
            const slot = await ParkingSlot.create({
              parking_lot_id: parkingLot.id,
              slot_number: slotNumber,
              coordinates: {
                x: col * (slotWidth * 20) + (slotWidth * 10), // Convert to pixels
                y: row * (slotHeight * 20) + (slotHeight * 10),
                width: slotWidth * 18,
                height: slotHeight * 18
              }
            });
            slots.push(slot);
          }
        }
      }

      res.status(201).json({
        success: true,
        message: 'Parking lot created successfully',
        data: {
          parking_lot: parkingLot.toJSON(),
          slots_created: slots.length
        }
      });
    } catch (error) {
      console.error('Error creating parking lot:', error);
      res.status(500).json({
        error: 'Failed to create parking lot',
        message: error.message
      });
    }
  }

  // Update parking lot
  static async updateParkingLot(req, res) {
    try {
      const { lotId } = req.params;
      const { error, value } = updateLotSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          error: 'Validation error',
          details: error.details[0].message
        });
      }

      if (!lotId || isNaN(lotId)) {
        return res.status(400).json({
          error: 'Invalid parking lot ID'
        });
      }

      const parkingLot = await ParkingLot.findById(parseInt(lotId));
      if (!parkingLot) {
        return res.status(404).json({
          error: 'Parking lot not found'
        });
      }

      // Update parking lot
      await parkingLot.update(value);

      res.json({
        success: true,
        message: 'Parking lot updated successfully',
        data: {
          parking_lot: parkingLot.toJSON()
        }
      });
    } catch (error) {
      console.error('Error updating parking lot:', error);
      res.status(500).json({
        error: 'Failed to update parking lot',
        message: error.message
      });
    }
  }

  // Delete parking lot
  static async deleteParkingLot(req, res) {
    try {
      const { lotId } = req.params;

      if (!lotId || isNaN(lotId)) {
        return res.status(400).json({
          error: 'Invalid parking lot ID'
        });
      }

      const parkingLot = await ParkingLot.findById(parseInt(lotId));
      if (!parkingLot) {
        return res.status(404).json({
          error: 'Parking lot not found'
        });
      }

      await parkingLot.delete();

      res.json({
        success: true,
        message: 'Parking lot deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting parking lot:', error);
      res.status(500).json({
        error: 'Failed to delete parking lot',
        message: error.message
      });
    }
  }

  // Get system analytics
  static async getSystemAnalytics(req, res) {
    try {
      const days = parseInt(req.query.days) || 7;

      // Defaults in case tables are missing or empty
      let overallStatistics = {
        total_lots: 0,
        total_slots: 0,
        occupied_slots: 0,
        overall_occupancy_rate: 0
      };

      let dailyAnalyticsRows = [];
      let hourlyAnalyticsRows = [];
      let processingStats = [];
      let recentActivityRows = [];

      // Get overall statistics (safe)
      try {
        const overallStats = await db.query(`
          SELECT 
            COUNT(DISTINCT pl.id) as total_lots,
            COUNT(ps.id) as total_slots,
            COUNT(CASE WHEN ps.is_occupied = true THEN 1 END) as occupied_slots,
            CASE 
              WHEN COUNT(ps.id) = 0 THEN 0
              ELSE ROUND(
                (COUNT(CASE WHEN ps.is_occupied = true THEN 1 END)::DECIMAL / NULLIF(COUNT(ps.id), 0)) * 100,
                2
              )
            END as overall_occupancy_rate
          FROM parking_lots pl
          LEFT JOIN parking_slots ps ON pl.id = ps.parking_lot_id
          WHERE pl.is_active = true
        `);
        overallStatistics = overallStats.rows[0] || overallStatistics;
      } catch (_) {}

      // Get daily analytics (safe)
      try {
        const dailyAnalytics = await db.query(`
          SELECT 
            date,
            COALESCE(AVG(occupancy_rate), 0) as avg_occupancy_rate,
            COALESCE(SUM(total_vehicles), 0) as total_vehicles,
            COALESCE(SUM(revenue), 0) as total_revenue
          FROM parking_analytics 
          WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
          GROUP BY date
          ORDER BY date DESC
        `);
        dailyAnalyticsRows = dailyAnalytics.rows;
      } catch (_) {}

      // Get hourly analytics for today (safe)
      try {
        const hourlyAnalytics = await db.query(`
          SELECT 
            hour,
            COALESCE(AVG(occupancy_rate), 0) as avg_occupancy_rate,
            COALESCE(SUM(total_vehicles), 0) as total_vehicles,
            COALESCE(SUM(revenue), 0) as total_revenue
          FROM parking_analytics 
          WHERE date = CURRENT_DATE
          GROUP BY hour
          ORDER BY hour ASC
        `);
        hourlyAnalyticsRows = hourlyAnalytics.rows;
      } catch (_) {}

      // Get processing statistics (safe)
      try {
        processingStats = await VideoAnalysis.getProcessingStats();
      } catch (_) {}

      // Get recent activity (safe)
      try {
        const recentActivity = await db.query(`
          SELECT 
            'booking' as activity_type,
            ps.slot_number,
            pl.name as parking_lot_name,
            b.created_at as timestamp
          FROM bookings b
          JOIN parking_slots ps ON b.parking_slot_id = ps.id
          JOIN parking_lots pl ON ps.parking_lot_id = pl.id
          WHERE b.created_at >= NOW() - INTERVAL '24 hours'
          
          UNION ALL
          
          SELECT 
            'video_analysis' as activity_type,
            va.video_filename as slot_number,
            pl.name as parking_lot_name,
            va.created_at as timestamp
          FROM video_analysis va
          JOIN parking_lots pl ON va.parking_lot_id = pl.id
          WHERE va.created_at >= NOW() - INTERVAL '24 hours'
          
          ORDER BY timestamp DESC
          LIMIT 20
        `);
        recentActivityRows = recentActivity.rows;
      } catch (_) {}

      res.json({
        success: true,
        data: {
          overall_statistics: overallStatistics,
          daily_analytics: dailyAnalyticsRows,
          hourly_analytics: hourlyAnalyticsRows,
          processing_statistics: processingStats,
          recent_activity: recentActivityRows
        }
      });
    } catch (error) {
      console.error('Error getting system analytics:', error);
      // Return safe defaults instead of 500 to avoid breaking the dashboard
      res.json({
        success: true,
        data: {
          overall_statistics: {
            total_lots: 0,
            total_slots: 0,
            occupied_slots: 0,
            overall_occupancy_rate: 0
          },
          daily_analytics: [],
          hourly_analytics: [],
          processing_statistics: [],
          recent_activity: []
        },
        warning: 'System analytics degraded: ' + (error?.message || 'unknown error')
      });
    }
  }

  // Get parking lot analytics
  static async getParkingLotAnalytics(req, res) {
    try {
      const { lotId } = req.params;
      const days = parseInt(req.query.days) || 7;

      if (!lotId || isNaN(lotId)) {
        return res.status(400).json({
          error: 'Invalid parking lot ID'
        });
      }

      const parkingLot = await ParkingLot.findById(parseInt(lotId));
      if (!parkingLot) {
        return res.status(404).json({
          error: 'Parking lot not found'
        });
      }

      // Get lot analytics
      const analytics = await parkingLot.getAnalytics(days);
      const statistics = await parkingLot.getStatistics();
      const recentAnalyses = await parkingLot.getRecentAnalyses(10);

      // Get peak hours
      const peakHours = await db.query(`
        SELECT 
          hour,
          AVG(occupancy_rate) as avg_occupancy_rate
        FROM parking_analytics 
        WHERE parking_lot_id = $1 
          AND date >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY hour
        ORDER BY avg_occupancy_rate DESC
        LIMIT 5
      `, [parseInt(lotId)]);

      res.json({
        success: true,
        data: {
          parking_lot: parkingLot.toJSON(),
          current_statistics: statistics,
          analytics: analytics,
          peak_hours: peakHours.rows,
          recent_analyses: recentAnalyses
        }
      });
    } catch (error) {
      console.error('Error getting parking lot analytics:', error);
      res.status(500).json({
        error: 'Failed to get parking lot analytics',
        message: error.message
      });
    }
  }

  // Get camera/video/image sources for parking lots
  static async getCameraSources(req, res) {
    try {
      const lotId = req.query.lotId || req.query.parking_lot_id;
      const includeInactive = req.query.include_inactive === 'true';
      const params = [];
      const filters = [];

      if (!includeInactive) {
        filters.push('cs.is_active = true');
      }

      if (lotId) {
        if (isNaN(lotId)) {
          return res.status(400).json({
            error: 'Invalid parking lot ID'
          });
        }

        params.push(parseInt(lotId, 10));
        filters.push(`cs.parking_lot_id = $${params.length}`);
      }

      const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

      const result = await db.query(`
        SELECT
          cs.id,
          cs.parking_lot_id,
          cs.camera_external_id,
          cs.name,
          cs.source_kind,
          cs.source_url,
          cs.coverage_description,
          cs.status,
          cs.last_seen_at,
          cs.ai_pipeline,
          cs.metadata,
          cs.is_active,
          cs.created_at,
          cs.updated_at,
          pl.name AS parking_lot_name,
          pl.slot_configuration->'metadata'->>'source_external_id' AS parking_lot_source_id
        FROM camera_sources cs
        LEFT JOIN parking_lots pl ON pl.id = cs.parking_lot_id
        ${whereClause}
        ORDER BY pl.name NULLS LAST, cs.name
      `, params);

      const summary = result.rows.reduce((accumulator, camera) => {
        accumulator.total += 1;
        accumulator.by_status[camera.status] = (accumulator.by_status[camera.status] || 0) + 1;
        accumulator.by_source_kind[camera.source_kind] = (accumulator.by_source_kind[camera.source_kind] || 0) + 1;
        if (camera.parking_lot_id) {
          accumulator.matched_parking_lots += 1;
        }
        return accumulator;
      }, {
        total: 0,
        matched_parking_lots: 0,
        by_status: {},
        by_source_kind: {}
      });

      res.json({
        success: true,
        data: {
          camera_sources: result.rows,
          count: result.rows.length,
          summary
        }
      });
    } catch (error) {
      if (error.code === '42P01') {
        return res.json({
          success: true,
          data: {
            camera_sources: [],
            count: 0,
            summary: {
              total: 0,
              matched_parking_lots: 0,
              by_status: {},
              by_source_kind: {}
            }
          },
          warning: 'camera_sources table has not been initialized yet'
        });
      }

      console.error('Error getting camera sources:', error);
      res.status(500).json({
        error: 'Failed to get camera sources',
        message: error.message
      });
    }
  }

  static async ensureInferenceEventsTable(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS inference_events (
        id SERIAL PRIMARY KEY,
        camera_source_id INTEGER REFERENCES camera_sources(id) ON DELETE SET NULL,
        parking_lot_id INTEGER REFERENCES parking_lots(id) ON DELETE CASCADE,
        model_name VARCHAR(100),
        input_path TEXT,
        total_slots INTEGER DEFAULT 0,
        occupied_count INTEGER DEFAULT 0,
        vacant_count INTEGER DEFAULT 0,
        average_confidence DECIMAL(5,4),
        result_payload JSONB,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_inference_events_camera_id ON inference_events(camera_source_id);
      CREATE INDEX IF NOT EXISTS idx_inference_events_lot_id ON inference_events(parking_lot_id);
      CREATE INDEX IF NOT EXISTS idx_inference_events_created ON inference_events(created_at);
    `);
  }

  static async resolveInferenceParkingContext(client, value) {
    let cameraSource = null;

    if (value.camera_id || value.camera_external_id) {
      const cameraResult = await client.query(
        `SELECT * FROM camera_sources
         WHERE ($1::INTEGER IS NOT NULL AND id = $1)
            OR ($2::TEXT IS NOT NULL AND camera_external_id = $2)
         LIMIT 1`,
        [value.camera_id || null, value.camera_external_id || null]
      );
      cameraSource = cameraResult.rows[0] || null;
    }

    let parkingLotId = value.parking_lot_id || cameraSource?.parking_lot_id || null;

    if (!parkingLotId && value.parking_lot_source_id) {
      const lotResult = await client.query(
        `SELECT id FROM parking_lots
         WHERE slot_configuration->'metadata'->>'source_external_id' = $1
         LIMIT 1`,
        [value.parking_lot_source_id]
      );
      parkingLotId = lotResult.rows[0]?.id || null;
    }

    if (!parkingLotId) {
      throw new Error('Unable to resolve parking_lot_id from camera or parking_lot_source_id.');
    }

    const parkingLot = await client.query('SELECT id, name FROM parking_lots WHERE id = $1', [parkingLotId]);
    if (parkingLot.rows.length === 0) {
      throw new Error('Parking lot not found for inference result.');
    }

    return {
      cameraSource,
      parkingLot: parkingLot.rows[0]
    };
  }

  // Submit normalized AI inference results and update parking slot status
  static async submitInferenceEvent(req, res) {
    const { error, value } = inferenceEventSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    try {
      const result = await InferenceEventService.recordInferenceEvent(value, req.io);

      res.status(201).json({
        success: true,
        message: `${result.updated_slots.length} slots updated from inference result`,
        data: result
      });
    } catch (submitError) {
      console.error('Error submitting inference event:', submitError);
      res.status(500).json({
        error: 'Failed to submit inference event',
        message: submitError.message
      });
    }
  }

  // List recent normalized AI inference events
  static async getInferenceEvents(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const lotId = req.query.lotId || req.query.parking_lot_id;
      const params = [];
      const filters = [];

      if (lotId) {
        if (isNaN(lotId)) {
          return res.status(400).json({
            error: 'Invalid parking lot ID'
          });
        }
        params.push(parseInt(lotId, 10));
        filters.push(`ie.parking_lot_id = $${params.length}`);
      }

      params.push(limit);
      const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

      const result = await db.query(`
        SELECT
          ie.*,
          pl.name AS parking_lot_name,
          cs.camera_external_id,
          cs.name AS camera_name,
          cs.source_kind
        FROM inference_events ie
        LEFT JOIN parking_lots pl ON pl.id = ie.parking_lot_id
        LEFT JOIN camera_sources cs ON cs.id = ie.camera_source_id
        ${whereClause}
        ORDER BY ie.created_at DESC
        LIMIT $${params.length}
      `, params);

      res.json({
        success: true,
        data: {
          inference_events: result.rows,
          count: result.rows.length
        }
      });
    } catch (listError) {
      if (listError.code === '42P01') {
        return res.json({
          success: true,
          data: {
            inference_events: [],
            count: 0
          },
          warning: 'inference_events table has not been initialized yet'
        });
      }

      console.error('Error getting inference events:', listError);
      res.status(500).json({
        error: 'Failed to get inference events',
        message: listError.message
      });
    }
  }

  // List AI image/video processing jobs for management workbench
  static async getAiProcessingJobs(req, res) {
    try {
      const filters = {
        status: req.query.status,
        parking_lot_id: req.query.lotId || req.query.parking_lot_id,
        camera_source_id: req.query.cameraSourceId || req.query.camera_source_id,
        job_type: req.query.job_type,
        limit: req.query.limit
      };

      const data = await AiProcessingJobService.listJobs(filters);

      res.json({
        success: true,
        data
      });
    } catch (error) {
      if (error.code === '42P01') {
        return res.json({
          success: true,
          data: {
            ai_processing_jobs: [],
            count: 0,
            summary: {}
          },
          warning: 'ai_processing_jobs table has not been initialized yet'
        });
      }

      console.error('Error getting AI processing jobs:', error);
      res.status(500).json({
        error: 'Failed to get AI processing jobs',
        message: error.message
      });
    }
  }

  // Register an AI processing job before image/video inference writes a result
  static async createAiProcessingJob(req, res) {
    const { error, value } = aiProcessingJobSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    try {
      const job = await AiProcessingJobService.createJob(value);

      res.status(201).json({
        success: true,
        message: 'AI processing job created',
        data: {
          ai_processing_job: job
        }
      });
    } catch (createError) {
      console.error('Error creating AI processing job:', createError);
      res.status(500).json({
        error: 'Failed to create AI processing job',
        message: createError.message
      });
    }
  }

  // Run automatic ROI model inference on the configured public dataset/sample input
  static async runDemoAiModelInference(req, res) {
    try {
      const result = await DemoAiInferenceService.run({
        dryRun: Boolean(req.body?.dry_run || req.query?.dry_run),
        configPath: req.body?.config_path || req.query?.config_path
      });

      res.status(result.dry_run ? 200 : 201).json({
        success: true,
        message: result.dry_run
          ? 'Demo AI model inference dry run completed'
          : 'Demo AI model inference completed',
        data: result
      });
    } catch (inferenceError) {
      console.error('Error running demo AI model inference:', inferenceError);
      res.status(500).json({
        error: 'Failed to run demo AI model inference',
        message: inferenceError.message,
        hints: [
          'Run npm run seed:mvp first to create demo parking lot, camera source, slots and ROIs.',
          'Check ai-services/.venv, data/demo_ai_inference_config_cnrpark.json, the public sample input, and model checkpoint.',
          'This endpoint runs a public dataset/sample model inference demo only; it is not a live camera connection.'
        ]
      });
    }
  }

  // Update queued/processing/completed/failed status for an AI processing job
  static async updateAiProcessingJobStatus(req, res) {
    const jobId = parseInt(req.params.jobId, 10);
    if (!jobId) {
      return res.status(400).json({
        error: 'Invalid AI processing job ID'
      });
    }

    const { error, value } = aiProcessingJobStatusSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    try {
      const job = await AiProcessingJobService.updateStatus(jobId, value);

      res.json({
        success: true,
        message: 'AI processing job updated',
        data: {
          ai_processing_job: job
        }
      });
    } catch (updateError) {
      const statusCode = updateError.message.includes('not found') ? 404 : 500;

      console.error('Error updating AI processing job:', updateError);
      res.status(statusCode).json({
        error: 'Failed to update AI processing job',
        message: updateError.message
      });
    }
  }

  // Replay a completed demo/public-dataset AI job through the same closed loop
  static async rerunAiProcessingJob(req, res) {
    const jobId = parseInt(req.params.jobId, 10);
    if (!jobId) {
      return res.status(400).json({
        error: 'Invalid AI processing job ID'
      });
    }

    try {
      const result = await DemoAiRunService.rerunJob(jobId);

      res.status(201).json({
        success: true,
        message: 'AI processing job rerun completed',
        data: result
      });
    } catch (rerunError) {
      const statusCode = rerunError.statusCode || 500;

      console.error('Error rerunning AI processing job:', rerunError);
      res.status(statusCode).json({
        error: 'Failed to rerun AI processing job',
        message: rerunError.message,
        hints: [
          'Only completed demo/public-dataset jobs with result inference events can be replayed.',
          'Use npm run demo:ai-run after npm run seed:mvp to create a reusable demo job.'
        ]
      });
    }
  }

  // List registered open data sources and their latest import status
  static async getDataSources(req, res) {
    const client = await db.getClient();

    try {
      await ensureOpenDataTables(client);

      const result = await client.query(`
        SELECT
          ds.*,
          COALESCE(ref_counts.external_ref_count, 0)::INTEGER AS external_ref_count,
          COALESCE(snapshot_counts.snapshot_count, 0)::INTEGER AS snapshot_count,
          COALESCE(candidate_counts.candidate_count, 0)::INTEGER AS candidate_count,
          latest_job.id AS latest_import_job_id,
          latest_job.status AS latest_import_status,
          latest_job.records_seen AS latest_records_seen,
          latest_job.records_imported AS latest_records_imported,
          latest_job.records_failed AS latest_records_failed,
          latest_job.started_at AS latest_import_started_at,
          latest_job.completed_at AS latest_import_completed_at
        FROM data_sources ds
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS external_ref_count
          FROM parking_lot_external_refs refs
          WHERE refs.source_key = ds.source_key
        ) ref_counts ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS snapshot_count
          FROM parking_occupancy_snapshots snapshots
          WHERE snapshots.source_key = ds.source_key
        ) snapshot_counts ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS candidate_count
          FROM parking_lot_candidates candidates
          WHERE candidates.source_key = ds.source_key
            AND candidates.is_active = true
        ) candidate_counts ON true
        LEFT JOIN LATERAL (
          SELECT *
          FROM open_data_import_jobs jobs
          WHERE jobs.source_key = ds.source_key
          ORDER BY jobs.started_at DESC, jobs.id DESC
          LIMIT 1
        ) latest_job ON true
        ORDER BY
          CASE
            WHEN ds.priority = 'P0' THEN 0
            WHEN ds.priority = 'P1' THEN 1
            WHEN ds.priority = 'P2' THEN 2
            WHEN ds.priority = 'P3' THEN 3
            ELSE 9
          END,
          CASE
            WHEN ds.source_key LIKE 'beijing_%' THEN 0
            WHEN ds.source_key LIKE 'osm_%' THEN 1
            ELSE 2
          END,
          ds.source_key
      `);

      const summary = result.rows.reduce((accumulator, source) => {
        accumulator.total += 1;
        accumulator.by_category[source.category || 'unknown'] = (accumulator.by_category[source.category || 'unknown'] || 0) + 1;
        accumulator.requires_key += source.requires_key ? 1 : 0;
        accumulator.external_refs += Number(source.external_ref_count || 0);
        accumulator.snapshots += Number(source.snapshot_count || 0);
        accumulator.candidates += Number(source.candidate_count || 0);
        if (source.latest_import_status) {
          accumulator.latest_statuses[source.latest_import_status] = (accumulator.latest_statuses[source.latest_import_status] || 0) + 1;
        }
        return accumulator;
      }, {
        total: 0,
        requires_key: 0,
        external_refs: 0,
        snapshots: 0,
        candidates: 0,
        by_category: {},
        latest_statuses: {}
      });

      res.json({
        success: true,
        data: {
          data_sources: result.rows,
          count: result.rows.length,
          summary
        }
      });
    } catch (error) {
      console.error('Error getting data sources:', error);
      res.status(500).json({
        error: 'Failed to get data sources',
        message: error.message
      });
    } finally {
      client.release();
    }
  }

  // List open data import jobs
  static async getOpenDataImportJobs(req, res) {
    const client = await db.getClient();

    try {
      await ensureOpenDataTables(client);

      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const sourceKey = req.query.source_key || req.query.sourceKey;
      const status = req.query.status;
      const params = [];
      const filters = [];

      if (sourceKey) {
        params.push(sourceKey);
        filters.push(`jobs.source_key = $${params.length}`);
      }

      if (status) {
        params.push(status);
        filters.push(`jobs.status = $${params.length}`);
      }

      params.push(limit);
      const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

      const result = await client.query(`
        SELECT
          jobs.*,
          ds.name AS data_source_name,
          ds.provider AS data_source_provider,
          ds.official_url AS data_source_url
        FROM open_data_import_jobs jobs
        LEFT JOIN data_sources ds ON ds.id = jobs.data_source_id
        ${whereClause}
        ORDER BY jobs.started_at DESC, jobs.id DESC
        LIMIT $${params.length}
      `, params);

      const summaryResult = await client.query(`
        SELECT
          status,
          COUNT(*)::INTEGER AS count
        FROM open_data_import_jobs
        GROUP BY status
        ORDER BY status
      `);

      res.json({
        success: true,
        data: {
          import_jobs: result.rows,
          count: result.rows.length,
          summary: {
            by_status: summaryResult.rows.reduce((accumulator, row) => {
              accumulator[row.status] = row.count;
              return accumulator;
            }, {})
          }
        }
      });
    } catch (error) {
      console.error('Error getting open data import jobs:', error);
      res.status(500).json({
        error: 'Failed to get open data import jobs',
        message: error.message
      });
    } finally {
      client.release();
    }
  }

  // List recent occupancy snapshots created from open data imports
  static async getOpenDataOccupancySnapshots(req, res) {
    const client = await db.getClient();

    try {
      await ensureOpenDataTables(client);

      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const sourceKey = req.query.source_key || req.query.sourceKey;
      const params = [];
      const filters = [];

      if (sourceKey) {
        params.push(sourceKey);
        filters.push(`snapshots.source_key = $${params.length}`);
      }

      params.push(limit);
      const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

      const result = await client.query(`
        SELECT
          snapshots.*,
          ds.name AS data_source_name,
          pl.name AS parking_lot_name
        FROM parking_occupancy_snapshots snapshots
        LEFT JOIN data_sources ds ON ds.id = snapshots.data_source_id
        LEFT JOIN parking_lots pl ON pl.id = snapshots.parking_lot_id
        ${whereClause}
        ORDER BY snapshots.observed_at DESC, snapshots.id DESC
        LIMIT $${params.length}
      `, params);

      res.json({
        success: true,
        data: {
          occupancy_snapshots: result.rows,
          count: result.rows.length
        }
      });
    } catch (error) {
      console.error('Error getting open data occupancy snapshots:', error);
      res.status(500).json({
        error: 'Failed to get open data occupancy snapshots',
        message: error.message
      });
    } finally {
      client.release();
    }
  }

  // List candidate parking POIs imported from map/open data sources
  static async getParkingLotCandidates(req, res) {
    const client = await db.getClient();

    try {
      await ensureOpenDataTables(client);

      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const sourceKey = req.query.source_key || req.query.sourceKey;
      const reviewStatus = req.query.review_status || req.query.reviewStatus;
      const params = [];
      const filters = ['candidates.is_active = true'];

      if (sourceKey) {
        params.push(sourceKey);
        filters.push(`candidates.source_key = $${params.length}`);
      }

      if (reviewStatus) {
        params.push(reviewStatus);
        filters.push(`candidates.review_status = $${params.length}`);
      }

      params.push(limit);
      const whereClause = `WHERE ${filters.join(' AND ')}`;

      const result = await client.query(`
        SELECT
          candidates.*,
          ds.name AS data_source_name,
          ds.official_url AS data_source_url,
          linked_lot.name AS linked_parking_lot_name
        FROM parking_lot_candidates candidates
        LEFT JOIN data_sources ds ON ds.id = candidates.data_source_id
        LEFT JOIN parking_lots linked_lot ON linked_lot.id = candidates.linked_parking_lot_id
        ${whereClause}
        ORDER BY
          CASE candidates.review_status
            WHEN 'linked' THEN 0
            WHEN 'shortlisted' THEN 1
            WHEN 'candidate' THEN 2
            WHEN 'rejected' THEN 3
            ELSE 4
          END,
          candidates.last_seen_at DESC,
          candidates.id DESC
        LIMIT $${params.length}
      `, params);

      const summaryResult = await client.query(`
        SELECT
          source_key,
          COUNT(*)::INTEGER AS count,
          COUNT(CASE WHEN name IS NOT NULL AND name <> '' THEN 1 END)::INTEGER AS named_count,
          COUNT(CASE WHEN capacity IS NOT NULL THEN 1 END)::INTEGER AS capacity_count,
          COUNT(CASE WHEN review_status = 'shortlisted' THEN 1 END)::INTEGER AS shortlisted_count,
          COUNT(CASE WHEN review_status = 'linked' THEN 1 END)::INTEGER AS linked_count,
          COUNT(CASE WHEN review_status = 'rejected' THEN 1 END)::INTEGER AS rejected_count
        FROM parking_lot_candidates
        WHERE is_active = true
        GROUP BY source_key
        ORDER BY source_key
      `);

      res.json({
        success: true,
        data: {
          parking_lot_candidates: result.rows,
          count: result.rows.length,
          summary: {
            by_source: summaryResult.rows
          }
        }
      });
    } catch (error) {
      console.error('Error getting parking lot candidates:', error);
      res.status(500).json({
        error: 'Failed to get parking lot candidates',
        message: error.message
      });
    } finally {
      client.release();
    }
  }

  // Review, shortlist, reject, or link a candidate POI to an existing managed parking lot
  static async updateParkingLotCandidateReview(req, res) {
    const candidateId = parseInt(req.params.candidateId, 10);
    if (!candidateId || Number.isNaN(candidateId)) {
      return res.status(400).json({
        error: 'Invalid candidate ID'
      });
    }

    const { error, value } = candidateReviewSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    if (value.review_status === 'linked' && !value.linked_parking_lot_id) {
      return res.status(400).json({
        error: 'linked_parking_lot_id is required when review_status is linked'
      });
    }

    const client = await db.getClient();

    try {
      await client.query('BEGIN');
      await ensureOpenDataTables(client);

      const candidateResult = await client.query(
        `SELECT *
         FROM parking_lot_candidates
         WHERE id = $1 AND is_active = true
         FOR UPDATE`,
        [candidateId]
      );

      if (candidateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'Parking lot candidate not found'
        });
      }

      const candidate = candidateResult.rows[0];
      const dataSourceResult = await client.query(
        'SELECT id FROM data_sources WHERE source_key = $1 LIMIT 1',
        [candidate.source_key]
      );
      const resolvedDataSourceId = dataSourceResult.rows[0]?.id || candidate.data_source_id || null;
      let linkedParkingLot = null;
      const linkedParkingLotId = value.review_status === 'linked' ? value.linked_parking_lot_id : null;

      if (linkedParkingLotId) {
        const lotResult = await client.query(
          'SELECT id, name FROM parking_lots WHERE id = $1 AND is_active = true',
          [linkedParkingLotId]
        );

        if (lotResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: 'Linked parking lot not found'
          });
        }

        linkedParkingLot = lotResult.rows[0];
      }

      const updatedResult = await client.query(
        `UPDATE parking_lot_candidates
         SET review_status = $1,
             review_notes = $2,
             linked_parking_lot_id = $3,
             reviewed_at = CURRENT_TIMESTAMP,
             review_metadata = $4
         WHERE id = $5
         RETURNING *`,
        [
          value.review_status,
          value.review_notes || null,
          linkedParkingLotId,
          JSON.stringify({
            reviewed_by: req.user?.username || 'admin',
            source: 'admin_governance_overview'
          }),
          candidateId
        ]
      );

      if (linkedParkingLotId) {
        await client.query(
          `INSERT INTO parking_lot_external_refs (
             parking_lot_id,
             data_source_id,
             source_key,
             external_id,
             external_name,
             metadata,
             last_seen_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
           ON CONFLICT (source_key, external_id)
           DO UPDATE SET
             parking_lot_id = EXCLUDED.parking_lot_id,
             data_source_id = EXCLUDED.data_source_id,
             external_name = EXCLUDED.external_name,
             metadata = EXCLUDED.metadata,
             last_seen_at = CURRENT_TIMESTAMP`,
          [
            linkedParkingLotId,
            resolvedDataSourceId,
            candidate.source_key,
            candidate.external_id,
            candidate.name,
            JSON.stringify({
              linked_from_candidate_id: candidate.id,
              review_status: value.review_status,
              review_notes: value.review_notes || null,
              linked_parking_lot_name: linkedParkingLot.name
            })
          ]
        );
      } else {
        await client.query(
          `DELETE FROM parking_lot_external_refs
           WHERE source_key = $1
             AND external_id = $2
             AND metadata->>'linked_from_candidate_id' = $3`,
          [candidate.source_key, candidate.external_id, String(candidate.id)]
        );
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        data: {
          parking_lot_candidate: {
            ...updatedResult.rows[0],
            linked_parking_lot_name: linkedParkingLot?.name || null
          }
        }
      });
    } catch (reviewError) {
      await client.query('ROLLBACK');
      console.error('Error updating parking lot candidate review:', reviewError);
      res.status(500).json({
        error: 'Failed to update parking lot candidate review',
        message: reviewError.message
      });
    } finally {
      client.release();
    }
  }

  // Aggregated operations view for the admin parking status workspace
  static async getParkingOperations(req, res) {
    const client = await db.getClient();

    try {
      await ensureOpenDataTables(client);
      await AdminController.ensureInferenceEventsTable(client);
      await AiProcessingJobService.ensureAiProcessingJobsTable(client);
      await ParkingSlotRoiService.ensureParkingSlotRoisTable(client);

      const result = await client.query(`
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
          CASE
            WHEN COALESCE(slot_stats.total_slots, pl.total_slots, 0) > 0
              THEN ROUND((COALESCE(slot_stats.occupied_slots, 0)::NUMERIC / COALESCE(slot_stats.total_slots, pl.total_slots, 0)::NUMERIC) * 100, 2)
            ELSE 0
          END AS occupancy_rate,
          COALESCE(roi_stats.roi_slots, 0)::INTEGER AS roi_slots,
          roi_stats.roi_source_types,
          roi_stats.latest_roi_updated_at,
          CASE
            WHEN COALESCE(slot_stats.total_slots, pl.total_slots, 0) > 0
              THEN ROUND((COALESCE(roi_stats.roi_slots, 0)::NUMERIC / COALESCE(slot_stats.total_slots, pl.total_slots, 0)::NUMERIC) * 100, 2)
            ELSE 0
          END AS roi_coverage_rate,
          COALESCE(camera_stats.camera_source_count, 0)::INTEGER AS camera_source_count,
          COALESCE(camera_stats.online_count, 0)::INTEGER AS online_camera_count,
          COALESCE(camera_stats.offline_count, 0)::INTEGER AS offline_camera_count,
          COALESCE(camera_stats.sample_count, 0)::INTEGER AS sample_camera_count,
          COALESCE(camera_stats.planned_count, 0)::INTEGER AS planned_camera_count,
          camera_stats.last_seen_at AS latest_camera_seen_at,
          latest_inference.id AS latest_inference_event_id,
          latest_inference.model_name AS latest_model_name,
          latest_inference.created_at AS latest_inference_at,
          latest_inference.total_slots AS latest_inference_total_slots,
          latest_inference.occupied_count AS latest_inference_occupied_count,
          latest_inference.vacant_count AS latest_inference_vacant_count,
          latest_inference.average_confidence AS latest_inference_average_confidence,
          latest_job.id AS latest_ai_processing_job_id,
          latest_job.job_type AS latest_ai_processing_job_type,
          latest_job.status AS latest_ai_processing_job_status,
          latest_job.progress_percent AS latest_ai_processing_job_progress,
          latest_job.created_at AS latest_ai_processing_job_created_at,
          latest_job.started_at AS latest_ai_processing_job_started_at,
          latest_job.completed_at AS latest_ai_processing_job_completed_at,
          latest_job.error_message AS latest_ai_processing_job_error_message,
          latest_snapshot.source_key AS latest_open_data_source_key,
          latest_snapshot.observed_at AS latest_open_data_observed_at,
          latest_snapshot.available_spaces AS latest_open_data_available_spaces,
          latest_snapshot.availability_level AS latest_open_data_availability_level
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
            COUNT(DISTINCT psr.parking_slot_id) AS roi_slots,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT psr.source_type), NULL) AS roi_source_types,
            MAX(psr.updated_at) AS latest_roi_updated_at
          FROM parking_slot_rois psr
          WHERE psr.parking_lot_id = pl.id
            AND psr.is_active = true
        ) roi_stats ON true
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (WHERE cs.is_active = true) AS camera_source_count,
            COUNT(*) FILTER (WHERE cs.is_active = true AND cs.status = 'online') AS online_count,
            COUNT(*) FILTER (WHERE cs.is_active = true AND cs.status = 'offline') AS offline_count,
            COUNT(*) FILTER (WHERE cs.is_active = true AND cs.status = 'sample') AS sample_count,
            COUNT(*) FILTER (WHERE cs.is_active = true AND cs.status = 'planned') AS planned_count,
            MAX(cs.last_seen_at) AS last_seen_at
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
          FROM ai_processing_jobs jobs
          WHERE jobs.parking_lot_id = pl.id
          ORDER BY jobs.created_at DESC, jobs.id DESC
          LIMIT 1
        ) latest_job ON true
        LEFT JOIN LATERAL (
          SELECT *
          FROM parking_occupancy_snapshots snapshots
          WHERE snapshots.parking_lot_id = pl.id
          ORDER BY snapshots.observed_at DESC, snapshots.id DESC
          LIMIT 1
        ) latest_snapshot ON true
        WHERE pl.is_active = true
        ORDER BY occupancy_rate DESC, pl.name
      `);

      const recommendationData = await ArrivalAssuranceService.getRecommendations({ limit: 50 });
      const recommendationByLotId = new Map(
        recommendationData.recommendations.map((recommendation) => [Number(recommendation.id), recommendation])
      );
      const now = Date.now();
      const lots = result.rows.map((lot) => {
        const totalSlots = Number(lot.total_slots || lot.configured_total_slots || 0);
        const occupiedSlots = Number(lot.occupied_slots || 0);
        const availableSlots = Number(lot.available_slots || Math.max(totalSlots - occupiedSlots, 0));
        const occupancyRate = Number(lot.occupancy_rate || 0);
        const roiCoverageRate = Number(lot.roi_coverage_rate || 0);
        const cameraSourceCount = Number(lot.camera_source_count || 0);
        const onlineCameraCount = Number(lot.online_camera_count || 0);
        const sampleCameraCount = Number(lot.sample_camera_count || 0);
        const metadata = lot.slot_configuration?.metadata || {};
        const hasCoordinates = Boolean(metadata.latitude && metadata.longitude);
        const hasFeeRule = Boolean(metadata.fee_rule);
        const latestSignalAt = lot.latest_inference_at || lot.latest_open_data_observed_at || metadata.imported_at || lot.updated_at;
        const recommendation = recommendationByLotId.get(Number(lot.id));
        const signalAgeHours = latestSignalAt
          ? Math.max(0, (now - new Date(latestSignalAt).getTime()) / (60 * 60 * 1000))
          : null;
        const freshnessScore = signalAgeHours === null
          ? 25
          : signalAgeHours <= 1 ? 100 : signalAgeHours <= 6 ? 85 : signalAgeHours <= 24 ? 65 : signalAgeHours <= 72 ? 45 : 25;
        const arrivalQualityScore = Math.round(
          (hasCoordinates ? 20 : 0)
          + (hasFeeRule ? 15 : 0)
          + Math.min(25, roiCoverageRate * 0.25)
          + (lot.latest_inference_at ? 25 : 0)
          + freshnessScore * 0.15
        );
        const missingArrivalFields = [
          !hasCoordinates ? '坐标' : null,
          !hasFeeRule ? '收费规则' : null,
          !lot.latest_inference_at ? 'AI 事件' : null,
          roiCoverageRate <= 0 ? 'ROI' : null
        ].filter(Boolean);
        const alerts = [];

        if (totalSlots > 0 && occupancyRate >= 90) {
          alerts.push({ code: 'full_warning', level: 'critical', message: '占用率达到 90% 以上，建议启动满位诱导或临停分流。' });
        } else if (totalSlots > 0 && occupancyRate >= 75) {
          alerts.push({ code: 'high_occupancy', level: 'warning', message: '占用率达到 75% 以上，属于高占用状态。' });
        }

        if (cameraSourceCount === 0) {
          alerts.push({ code: 'no_camera_source', level: 'warning', message: '尚未登记摄像头、视频文件或样例图片来源。' });
        } else if (onlineCameraCount === 0 && sampleCameraCount === 0) {
          alerts.push({ code: 'camera_source_unavailable', level: 'warning', message: '已登记来源但当前没有在线或样例源。' });
        }

        if (totalSlots > 0 && roiCoverageRate > 0 && roiCoverageRate < 80) {
          alerts.push({ code: 'low_roi_coverage', level: 'notice', message: 'ROI 覆盖不足 80%，AI 识别只能代表局部车位。' });
        } else if (totalSlots > 0 && roiCoverageRate === 0) {
          alerts.push({ code: 'missing_roi', level: 'notice', message: '尚未配置 ROI 车位区域，无法形成完整视觉识别闭环。' });
        }

        if (!lot.latest_inference_at) {
          alerts.push({ code: 'no_inference_event', level: 'notice', message: '暂无标准化 AI 识别事件。' });
        } else if (now - new Date(lot.latest_inference_at).getTime() > 24 * 60 * 60 * 1000) {
          alerts.push({ code: 'stale_inference', level: 'notice', message: '最近 AI 识别事件已超过 24 小时。' });
        }

        if (!lot.latest_ai_processing_job_id && (cameraSourceCount > 0 || roiCoverageRate > 0)) {
          alerts.push({ code: 'no_ai_processing_job', level: 'notice', message: '暂无 AI 处理任务记录，后续视频/图片处理需要纳入任务闭环。' });
        } else if (lot.latest_ai_processing_job_status === 'failed') {
          alerts.push({ code: 'ai_processing_failed', level: 'warning', message: '最近 AI 处理任务失败，需要查看错误并重跑。' });
        } else if (
          lot.latest_ai_processing_job_status === 'processing' &&
          lot.latest_ai_processing_job_started_at &&
          now - new Date(lot.latest_ai_processing_job_started_at).getTime() > 30 * 60 * 1000
        ) {
          alerts.push({ code: 'ai_processing_stale', level: 'warning', message: 'AI 处理任务超过 30 分钟仍未完成，需要检查推理进程。' });
        }

        if (lot.latest_open_data_observed_at && now - new Date(lot.latest_open_data_observed_at).getTime() > 24 * 60 * 60 * 1000) {
          alerts.push({ code: 'open_data_stale', level: 'notice', message: '开放数据余位快照已超过 24 小时，需要重新导入或核验。' });
        }

        if (arrivalQualityScore < 60) {
          alerts.push({ code: 'arrival_assurance_low', level: 'notice', message: '到场保障质量偏低，需要补齐坐标、收费、ROI 或最近 AI/开放数据。' });
        }

        return {
          id: lot.id,
          name: lot.name,
          video_url: lot.video_url,
          slot_configuration: lot.slot_configuration,
          is_active: lot.is_active,
          created_at: lot.created_at,
          updated_at: lot.updated_at,
          statistics: {
            total_slots: totalSlots,
            occupied_slots: occupiedSlots,
            available_slots: availableSlots,
            occupancy_rate: occupancyRate
          },
          roi: {
            roi_slots: Number(lot.roi_slots || 0),
            roi_coverage_rate: roiCoverageRate,
            source_types: lot.roi_source_types || [],
            latest_updated_at: lot.latest_roi_updated_at
          },
          camera: {
            camera_source_count: cameraSourceCount,
            online_count: onlineCameraCount,
            offline_count: Number(lot.offline_camera_count || 0),
            sample_count: sampleCameraCount,
            planned_count: Number(lot.planned_camera_count || 0),
            latest_seen_at: lot.latest_camera_seen_at
          },
          inference: {
            latest_event_id: lot.latest_inference_event_id,
            latest_model_name: lot.latest_model_name,
            latest_event_at: lot.latest_inference_at,
            latest_total_slots: lot.latest_inference_total_slots,
            latest_occupied_count: lot.latest_inference_occupied_count,
            latest_vacant_count: lot.latest_inference_vacant_count,
            latest_average_confidence: lot.latest_inference_average_confidence
          },
          ai_processing: {
            latest_job_id: lot.latest_ai_processing_job_id,
            latest_job_type: lot.latest_ai_processing_job_type,
            latest_status: lot.latest_ai_processing_job_status,
            latest_progress_percent: lot.latest_ai_processing_job_progress,
            latest_created_at: lot.latest_ai_processing_job_created_at,
            latest_started_at: lot.latest_ai_processing_job_started_at,
            latest_completed_at: lot.latest_ai_processing_job_completed_at,
            latest_error_message: lot.latest_ai_processing_job_error_message
          },
          open_data: {
            latest_source_key: lot.latest_open_data_source_key,
            latest_observed_at: lot.latest_open_data_observed_at,
            latest_available_spaces: lot.latest_open_data_available_spaces,
            latest_availability_level: lot.latest_open_data_availability_level
          },
          arrival_assurance: {
            quality_score: Math.min(100, arrivalQualityScore),
            quality_label: arrivalQualityScore >= 80 ? '保障较好' : arrivalQualityScore >= 60 ? '基本可用' : '需补数据',
            signal_age_hours: signalAgeHours === null ? null : Math.round(signalAgeHours * 10) / 10,
            has_coordinates: hasCoordinates,
            has_fee_rule: hasFeeRule,
            missing_fields: missingArrivalFields,
            recommendation_probability: recommendation?.probability ?? null,
            risk: recommendation?.risk || null,
            decision_status: recommendation?.decision_status || null,
            assurance_breakdown: recommendation?.assurance_breakdown || null,
            alternatives: recommendation?.alternatives || []
          },
          alerts
        };
      });

      const summary = lots.reduce((accumulator, lot) => {
        accumulator.total_lots += 1;
        accumulator.total_slots += lot.statistics.total_slots;
        accumulator.occupied_slots += lot.statistics.occupied_slots;
        accumulator.available_slots += lot.statistics.available_slots;
        accumulator.high_occupancy_lots += lot.statistics.occupancy_rate >= 75 ? 1 : 0;
        accumulator.full_warning_lots += lot.statistics.occupancy_rate >= 90 ? 1 : 0;
        accumulator.lots_without_camera += lot.camera.camera_source_count === 0 ? 1 : 0;
        accumulator.low_roi_coverage_lots += lot.roi.roi_coverage_rate < 80 ? 1 : 0;
        accumulator.stale_inference_lots += lot.alerts.some((alert) => ['no_inference_event', 'stale_inference'].includes(alert.code)) ? 1 : 0;
        accumulator.low_arrival_assurance_lots += lot.arrival_assurance.quality_score < 60 ? 1 : 0;
        accumulator.arrival_assurance_score_sum += lot.arrival_assurance.quality_score;
        accumulator.active_ai_processing_jobs += ['queued', 'processing'].includes(lot.ai_processing.latest_status) ? 1 : 0;
        accumulator.failed_ai_processing_jobs += lot.ai_processing.latest_status === 'failed' ? 1 : 0;
        return accumulator;
      }, {
        total_lots: 0,
        total_slots: 0,
        occupied_slots: 0,
        available_slots: 0,
        high_occupancy_lots: 0,
        full_warning_lots: 0,
        lots_without_camera: 0,
        low_roi_coverage_lots: 0,
        stale_inference_lots: 0,
        low_arrival_assurance_lots: 0,
        arrival_assurance_score_sum: 0,
        active_ai_processing_jobs: 0,
        failed_ai_processing_jobs: 0
      });

      summary.occupancy_rate = summary.total_slots > 0
        ? Math.round((summary.occupied_slots / summary.total_slots) * 1000) / 10
        : 0;
      summary.average_arrival_assurance_score = summary.total_lots > 0
        ? Math.round(summary.arrival_assurance_score_sum / summary.total_lots)
        : 0;

      res.json({
        success: true,
        data: {
          parking_operations: lots,
          summary,
          generated_at: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error getting parking operations:', error);
      res.status(500).json({
        error: 'Failed to get parking operations',
        message: error.message
      });
    } finally {
      client.release();
    }
  }

  // Governance-oriented summary for utilization, candidate resources, and peak-hour signals
  static async getGovernanceSummary(req, res) {
    const client = await db.getClient();

    try {
      await ensureOpenDataTables(client);
      await AdminController.ensureInferenceEventsTable(client);

      const districtResult = await client.query(`
        SELECT
          COALESCE(NULLIF(pl.slot_configuration->'metadata'->>'district', ''), '未标注区域') AS district,
          COUNT(DISTINCT pl.id)::INTEGER AS parking_lot_count,
          COALESCE(SUM(slot_stats.total_slots), 0)::INTEGER AS total_slots,
          COALESCE(SUM(slot_stats.occupied_slots), 0)::INTEGER AS occupied_slots,
          GREATEST(COALESCE(SUM(slot_stats.total_slots), 0) - COALESCE(SUM(slot_stats.occupied_slots), 0), 0)::INTEGER AS available_slots,
          COUNT(DISTINCT pl.id) FILTER (
            WHERE slot_stats.total_slots > 0
              AND (slot_stats.occupied_slots::NUMERIC / slot_stats.total_slots::NUMERIC) >= 0.75
          )::INTEGER AS high_occupancy_lots
        FROM parking_lots pl
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) AS total_slots,
            COUNT(*) FILTER (WHERE ps.is_occupied = true) AS occupied_slots
          FROM parking_slots ps
          WHERE ps.parking_lot_id = pl.id
        ) slot_stats ON true
        WHERE pl.is_active = true
        GROUP BY district
        ORDER BY
          CASE WHEN COALESCE(SUM(slot_stats.total_slots), 0) > 0
            THEN COALESCE(SUM(slot_stats.occupied_slots), 0)::NUMERIC / COALESCE(SUM(slot_stats.total_slots), 1)::NUMERIC
            ELSE 0
          END DESC,
          district
      `);

      const candidateStatusResult = await client.query(`
        SELECT
          review_status,
          COUNT(*)::INTEGER AS count,
          COUNT(*) FILTER (WHERE capacity IS NOT NULL)::INTEGER AS capacity_count,
          COUNT(*) FILTER (WHERE name IS NOT NULL AND name <> '')::INTEGER AS named_count
        FROM parking_lot_candidates
        WHERE is_active = true
        GROUP BY review_status
        ORDER BY review_status
      `);

      const candidateSourceResult = await client.query(`
        SELECT
          candidates.source_key,
          ds.name AS data_source_name,
          COUNT(*)::INTEGER AS count,
          COUNT(*) FILTER (WHERE candidates.review_status = 'shortlisted')::INTEGER AS shortlisted_count,
          COUNT(*) FILTER (WHERE candidates.review_status = 'linked')::INTEGER AS linked_count,
          COUNT(*) FILTER (WHERE candidates.review_status = 'rejected')::INTEGER AS rejected_count
        FROM parking_lot_candidates candidates
        LEFT JOIN data_sources ds ON ds.id = candidates.data_source_id
        WHERE candidates.is_active = true
        GROUP BY candidates.source_key, ds.name
        ORDER BY count DESC, candidates.source_key
      `);

      const peakHourResult = await client.query(`
        SELECT
          EXTRACT(HOUR FROM created_at)::INTEGER AS hour,
          COUNT(*)::INTEGER AS event_count,
          ROUND(AVG(occupied_count)::NUMERIC, 2) AS avg_occupied_count,
          ROUND(AVG(total_slots)::NUMERIC, 2) AS avg_total_slots,
          ROUND(AVG(
            CASE WHEN total_slots > 0 THEN (occupied_count::NUMERIC / total_slots::NUMERIC) * 100 ELSE NULL END
          ), 2) AS avg_occupancy_rate
        FROM inference_events
        WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        GROUP BY hour
        ORDER BY avg_occupancy_rate DESC NULLS LAST, event_count DESC, hour
        LIMIT 8
      `);

      const dataSourceResult = await client.query(`
        SELECT
          source_key,
          name,
          priority,
          requires_key,
          license_or_terms,
          official_url,
          is_active
        FROM data_sources
        WHERE is_active = true
        ORDER BY
          CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 9 END,
          source_key
      `);

      const highRiskDestinationResult = await client.query(`
        SELECT
          pl.id,
          pl.name,
          COALESCE(NULLIF(pl.slot_configuration->'metadata'->>'district', ''), '未标注区域') AS district,
          NULLIF(pl.slot_configuration->'metadata'->>'latitude', '') AS latitude,
          NULLIF(pl.slot_configuration->'metadata'->>'longitude', '') AS longitude,
          NULLIF(pl.slot_configuration->'metadata'->>'fee_rule', '') AS fee_rule,
          COALESCE(slot_stats.total_slots, 0)::INTEGER AS total_slots,
          GREATEST(COALESCE(slot_stats.total_slots, pl.total_slots, 0) - COALESCE(slot_stats.occupied_slots, 0), 0)::INTEGER AS available_slots,
          CASE
            WHEN COALESCE(slot_stats.total_slots, pl.total_slots, 0) > 0
              THEN ROUND((COALESCE(slot_stats.occupied_slots, 0)::NUMERIC / COALESCE(slot_stats.total_slots, pl.total_slots, 1)::NUMERIC) * 100, 2)
            ELSE 0
          END AS occupancy_rate,
          COALESCE(candidate_stats.candidate_count, 0)::INTEGER AS nearby_candidate_count
        FROM parking_lots pl
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) AS total_slots,
            COUNT(*) FILTER (WHERE ps.is_occupied = true) AS occupied_slots
          FROM parking_slots ps
          WHERE ps.parking_lot_id = pl.id
        ) slot_stats ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS candidate_count
          FROM parking_lot_candidates candidates
          WHERE candidates.is_active = true
            AND candidates.review_status IN ('candidate', 'shortlisted', 'linked')
            AND COALESCE(NULLIF(candidates.metadata->>'district', ''), COALESCE(NULLIF(pl.slot_configuration->'metadata'->>'district', ''), '未标注区域'))
              = COALESCE(NULLIF(pl.slot_configuration->'metadata'->>'district', ''), '未标注区域')
        ) candidate_stats ON true
        WHERE pl.is_active = true
          AND COALESCE(slot_stats.total_slots, pl.total_slots, 0) > 0
          AND (
            COALESCE(slot_stats.occupied_slots, 0)::NUMERIC / COALESCE(slot_stats.total_slots, pl.total_slots, 1)::NUMERIC
          ) >= 0.75
        ORDER BY occupancy_rate DESC, available_slots ASC
        LIMIT 8
      `);

      const districts = districtResult.rows.map((district) => {
        const totalSlots = Number(district.total_slots || 0);
        const occupiedSlots = Number(district.occupied_slots || 0);
        return {
          ...district,
          occupancy_rate: totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 1000) / 10 : 0
        };
      });

      const totalCandidates = candidateStatusResult.rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
      const shortlistedCandidates = candidateStatusResult.rows
        .filter((row) => row.review_status === 'shortlisted')
        .reduce((sum, row) => sum + Number(row.count || 0), 0);
      const linkedCandidates = candidateStatusResult.rows
        .filter((row) => row.review_status === 'linked')
        .reduce((sum, row) => sum + Number(row.count || 0), 0);

      const recommendations = [];
      const highOccupancyDistricts = districts.filter((district) => district.occupancy_rate >= 75);
      if (highOccupancyDistricts.length > 0) {
        recommendations.push({
          type: 'high_occupancy_area',
          level: 'warning',
          title: '高占用区域需优先巡查',
          description: `${highOccupancyDistricts.map((district) => district.district).join('、')} 当前占用率超过 75%，适合优先布设诱导、临停分流或采集高峰样本。`
        });
      }

      const arrivalRecommendationData = await ArrivalAssuranceService.getRecommendations({ limit: 50 });
      const arrivalRecommendationById = new Map(
        arrivalRecommendationData.recommendations.map((lot) => [Number(lot.id), lot])
      );
      const highRiskDestinations = highRiskDestinationResult.rows.map((lot) => {
        const recommendation = arrivalRecommendationById.get(Number(lot.id));
        const alternatives = (recommendation?.alternatives || []).map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          probability: candidate.probability,
          available_slots: candidate.available_slots,
          distance_km: candidate.distance_km,
          risk: candidate.risk
        }));

        return {
          ...lot,
          has_coordinates: Boolean(lot.latitude && lot.longitude),
          has_fee_rule: Boolean(lot.fee_rule),
          arrival_assurance_score: recommendation?.probability ?? null,
          risk: recommendation?.risk || null,
          decision_status: recommendation?.decision_status || null,
          alternatives,
          suggested_action: alternatives.length > 0 ? '建议诱导至备选承接点' : '建议核验周边候选资源'
        };
      });

      if (highRiskDestinations.length > 0) {
        recommendations.push({
          type: 'arrival_assurance_risk',
          level: 'warning',
          title: '高风险目的地需要备选承接',
          description: `${highRiskDestinations.slice(0, 3).map((lot) => lot.name).join('、')} 占用率偏高，用户端应优先展示 Plan B/Plan C 和到场风险提示。`
        });
      }

      if (totalCandidates > 0 && shortlistedCandidates + linkedCandidates < totalCandidates) {
        recommendations.push({
          type: 'candidate_review',
          level: 'notice',
          title: '候选停车资源仍需核验',
          description: `当前有 ${totalCandidates} 个候选 POI，其中 ${shortlistedCandidates} 个已关注、${linkedCandidates} 个已关联，剩余候选可作为街区调研清单。`
        });
      }

      const missingOfficialKeySources = dataSourceResult.rows.filter((source) => source.requires_key && source.priority === 'P0');
      if (missingOfficialKeySources.length > 0) {
        recommendations.push({
          type: 'official_data_key',
          level: 'notice',
          title: '官方在线接口仍需 userKey',
          description: `P0 数据源 ${missingOfficialKeySources.map((source) => source.name).join('、')} 需要官方 userKey，本阶段继续使用离线 CSV/XLSX 样例导入。`
        });
      }

      res.json({
        success: true,
        data: {
          districts,
          candidates: {
            total: totalCandidates,
            by_status: candidateStatusResult.rows,
            by_source: candidateSourceResult.rows
          },
          peak_hours: peakHourResult.rows,
          data_sources: dataSourceResult.rows,
          arrival_assurance: {
            high_risk_destinations: highRiskDestinations
          },
          recommendations,
          generated_at: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error getting governance summary:', error);
      res.status(500).json({
        error: 'Failed to get governance summary',
        message: error.message
      });
    } finally {
      client.release();
    }
  }

  // Get system configuration
  static async getSystemConfiguration(req, res) {
    try {
      // Get configuration from environment variables and database
      const config = {
        system: {
          environment: process.env.NODE_ENV || 'development',
          version: '1.0.0',
          uptime: process.uptime(),
          memory_usage: process.memoryUsage()
        },
        database: {
          host: process.env.DB_HOST || 'localhost',
          port: process.env.DB_PORT || 5432,
          database: process.env.DB_NAME || 'ai_parking_system'
        },
        ai_services: {
          python_path: process.env.PYTHON_PATH || 'python',
          video_processing_enabled: true,
          max_file_size: '500MB'
        },
        features: {
          real_time_updates: true,
          video_analysis: true,
          chatbot: true,
          analytics: true
        }
      };

      res.json({
        success: true,
        data: config
      });
    } catch (error) {
      console.error('Error getting system configuration:', error);
      res.status(500).json({
        error: 'Failed to get system configuration',
        message: error.message
      });
    }
  }

  // Update system configuration
  static async updateSystemConfiguration(req, res) {
    try {
      // This would typically update configuration in database or config files
      // For now, we'll just return the updated configuration
      const { configuration } = req.body;

      if (!configuration || typeof configuration !== 'object') {
        return res.status(400).json({
          error: 'Invalid configuration data'
        });
      }

      // In a real implementation, you would validate and save the configuration
      console.log('Configuration update requested:', configuration);

      res.json({
        success: true,
        message: 'Configuration updated successfully',
        data: {
          updated_configuration: configuration
        }
      });
    } catch (error) {
      console.error('Error updating system configuration:', error);
      res.status(500).json({
        error: 'Failed to update system configuration',
        message: error.message
      });
    }
  }

  // Get all users
  static async getAllUsers(req, res) {
    try {
      const query = `
        SELECT 
          id, username, email, role, is_active, created_at, updated_at
        FROM users 
        ORDER BY created_at DESC
      `;

      const result = await db.query(query);

      res.json({
        success: true,
        data: {
          users: result.rows,
          count: result.rows.length
        }
      });
    } catch (error) {
      console.error('Error getting all users:', error);
      res.status(500).json({
        error: 'Failed to get users',
        message: error.message
      });
    }
  }

  // Update user
  static async updateUser(req, res) {
    try {
      const { userId } = req.params;
      const { username, email, role, is_active } = req.body;

      if (!userId || isNaN(userId)) {
        return res.status(400).json({
          error: 'Invalid user ID'
        });
      }

      const fields = [];
      const values = [];
      let paramIndex = 1;

      if (username) {
        fields.push(`username = $${paramIndex}`);
        values.push(username);
        paramIndex++;
      }

      if (email) {
        fields.push(`email = $${paramIndex}`);
        values.push(email);
        paramIndex++;
      }

      if (role) {
        fields.push(`role = $${paramIndex}`);
        values.push(role);
        paramIndex++;
      }

      if (typeof is_active === 'boolean') {
        fields.push(`is_active = $${paramIndex}`);
        values.push(is_active);
        paramIndex++;
      }

      if (fields.length === 0) {
        return res.status(400).json({
          error: 'No fields to update'
        });
      }

      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(parseInt(userId));

      const query = `
        UPDATE users 
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, username, email, role, is_active, created_at, updated_at
      `;

      const result = await db.query(query, values);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      res.json({
        success: true,
        message: 'User updated successfully',
        data: {
          user: result.rows[0]
        }
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({
        error: 'Failed to update user',
        message: error.message
      });
    }
  }

  // Delete user
  static async deleteUser(req, res) {
    try {
      const { userId } = req.params;

      if (!userId || isNaN(userId)) {
        return res.status(400).json({
          error: 'Invalid user ID'
        });
      }

      const query = `
        UPDATE users 
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, username, email
      `;

      const result = await db.query(query, [parseInt(userId)]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      res.json({
        success: true,
        message: 'User deactivated successfully',
        data: {
          user: result.rows[0]
        }
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({
        error: 'Failed to delete user',
        message: error.message
      });
    }
  }

  // Generate system report
  static async generateSystemReport(req, res) {
    try {
      const reportType = req.query.type || 'summary';
      const days = parseInt(req.query.days) || 30;

      let report = {};

      switch (reportType) {
        case 'occupancy':
          report = await AdminController.generateOccupancyReport(days);
          break;
        case 'revenue':
          report = await AdminController.generateRevenueReport(days);
          break;
        case 'performance':
          report = await AdminController.generatePerformanceReport(days);
          break;
        default:
          report = await AdminController.generateSummaryReport(days);
      }

      res.json({
        success: true,
        data: {
          report_type: reportType,
          period_days: days,
          generated_at: new Date().toISOString(),
          ...report
        }
      });
    } catch (error) {
      console.error('Error generating system report:', error);
      res.status(500).json({
        error: 'Failed to generate system report',
        message: error.message
      });
    }
  }

  // Helper methods for report generation
  static async generateSummaryReport(days) {
    const overallStats = await db.query(`
      SELECT 
        COUNT(DISTINCT pl.id) as total_lots,
        COUNT(ps.id) as total_slots,
        COUNT(CASE WHEN ps.is_occupied = true THEN 1 END) as occupied_slots
      FROM parking_lots pl
      LEFT JOIN parking_slots ps ON pl.id = ps.parking_lot_id
      WHERE pl.is_active = true
    `);

    const analytics = await db.query(`
      SELECT 
        AVG(occupancy_rate) as avg_occupancy_rate,
        SUM(total_vehicles) as total_vehicles,
        SUM(revenue) as total_revenue
      FROM parking_analytics 
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
    `);

    return {
      summary: overallStats.rows[0],
      analytics: analytics.rows[0]
    };
  }

  static async generateOccupancyReport(days) {
    const dailyOccupancy = await db.query(`
      SELECT 
        date,
        AVG(occupancy_rate) as avg_occupancy_rate,
        MAX(occupancy_rate) as max_occupancy_rate,
        MIN(occupancy_rate) as min_occupancy_rate
      FROM parking_analytics 
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY date
      ORDER BY date DESC
    `);

    return {
      daily_occupancy: dailyOccupancy.rows
    };
  }

  static async generateRevenueReport(days) {
    const revenueData = await db.query(`
      SELECT 
        date,
        SUM(revenue) as daily_revenue,
        SUM(total_vehicles) as daily_vehicles
      FROM parking_analytics 
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY date
      ORDER BY date DESC
    `);

    return {
      revenue_data: revenueData.rows
    };
  }

  static async generatePerformanceReport(days) {
    const processingStats = await VideoAnalysis.getProcessingStats();
    
    const systemMetrics = {
      uptime: process.uptime(),
      memory_usage: process.memoryUsage(),
      cpu_usage: process.cpuUsage()
    };

    return {
      processing_statistics: processingStats,
      system_metrics: systemMetrics
    };
  }
}

module.exports = AdminController;
