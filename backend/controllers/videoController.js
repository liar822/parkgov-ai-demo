const VideoAnalysis = require('../models/VideoAnalysis');
const ParkingLot = require('../models/ParkingLot');
const ParkingSlot = require('../models/ParkingSlot');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PythonShell } = require('python-shell');
const Joi = require('joi');
const InferenceEventService = require('../services/inferenceEventService');
const AiProcessingJobService = require('../services/aiProcessingJobService');

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `parking-video-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept video files only
  const allowedTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only video files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  }
});

// Validation schemas
const startAnalysisSchema = Joi.object({
  parking_lot_id: Joi.number().integer().positive().required(),
  analysis_type: Joi.string().valid('occupancy', 'duration', 'full').default('full')
});

class VideoController {
  // Upload video file
  static uploadVideo = upload.single('video');

  // Handle video upload and start analysis
  static async handleVideoUpload(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'No video file uploaded'
        });
      }

      const { error, value } = startAnalysisSchema.validate(req.body);
      if (error) {
        // Clean up uploaded file if validation fails
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          error: 'Validation error',
          details: error.details[0].message
        });
      }

      const { parking_lot_id, analysis_type } = value;

      // Verify parking lot exists
      const parkingLot = await ParkingLot.findById(parking_lot_id);
      if (!parkingLot) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({
          error: 'Parking lot not found'
        });
      }

      // Create video analysis record
      const videoAnalysis = await VideoAnalysis.create({
        parking_lot_id: parking_lot_id,
        video_filename: req.file.filename,
        processing_status: 'pending',
        analysis_data: {
          analysis_type: analysis_type,
          file_info: {
            original_name: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype
          }
        }
      });

      const aiProcessingJob = await AiProcessingJobService.createJob({
        parking_lot_id,
        job_type: 'video_file',
        input_path: req.file.path,
        model_name: 'yolov8_parking_slot',
        status: 'queued',
        metadata: {
          video_analysis_id: videoAnalysis.id,
          original_name: req.file.originalname,
          upload_kind: 'local_video_file'
        },
        notes: 'Created from uploaded video file. This does not imply a live camera connection.'
      });

      // Start processing asynchronously
      VideoController.processVideoAsync(
        videoAnalysis.id,
        req.file.path,
        parking_lot_id,
        analysis_type,
        req.io,
        aiProcessingJob.id
      );

      res.json({
        success: true,
        message: 'Video uploaded successfully and processing started',
        data: {
          analysis_id: videoAnalysis.id,
          ai_processing_job_id: aiProcessingJob.id,
          ai_processing_job_external_id: aiProcessingJob.job_external_id,
          filename: req.file.filename,
          processing_status: 'pending',
          parking_lot_id: parking_lot_id
        }
      });
    } catch (error) {
      console.error('Error handling video upload:', error);
      
      // Clean up uploaded file on error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      res.status(500).json({
        error: 'Failed to process video upload',
        message: error.message
      });
    }
  }

  // Process video asynchronously
  static async processVideoAsync(analysisId, videoPath, parkingLotId, analysisType, io, aiProcessingJobId = null) {
    let videoAnalysis;
    
    try {
      // Get the analysis record and mark as processing
      videoAnalysis = await VideoAnalysis.findById(analysisId);
      if (!videoAnalysis) {
        throw new Error('Video analysis record not found');
      }

      await videoAnalysis.startProcessing();

      if (aiProcessingJobId) {
        await AiProcessingJobService.updateStatus(aiProcessingJobId, {
          status: 'processing',
          progress_percent: 20,
          metadata: {
            video_analysis_id: analysisId,
            processing_started_at: new Date().toISOString()
          }
        });
      }

      // Emit processing started event
      io.to(`parking-lot-${parkingLotId}`).emit('video-processing-started', {
        analysis_id: analysisId,
        ai_processing_job_id: aiProcessingJobId,
        status: 'processing',
        timestamp: new Date().toISOString()
      });

      // Get parking lot configuration
      const parkingLot = await ParkingLot.findById(parkingLotId);
      const slots = await ParkingSlot.findByLotId(parkingLotId);

      // Prepare slot configuration for Python script
      const slotConfig = slots.map(slot => ({
        id: slot.id,
        slot_number: slot.slot_number,
        coordinates: typeof slot.coordinates === 'string' 
          ? JSON.parse(slot.coordinates) 
          : slot.coordinates
      }));

      // Configure Python shell options
      const pythonOptions = {
        mode: 'json',
        pythonPath: process.env.PYTHON_PATH || 'python',
        scriptPath: path.join(__dirname, '../../ai-services'),
        args: [
          '--video_path', videoPath,
          '--analysis_type', analysisType,
          '--slot_config', JSON.stringify(slotConfig),
          '--parking_lot_id', parkingLotId.toString(),
          '--output_format', 'json'
        ]
      };

      // Run Python video processing script
      const results = await new Promise((resolve, reject) => {
        PythonShell.run('video_processor.py', pythonOptions, (err, results) => {
          if (err) {
            reject(err);
          } else {
            resolve(results);
          }
        });
      });

      // Process the results
      const analysisResults = results[results.length - 1]; // Get the last result (final output)
      
      let inferenceResult = null;
      if (analysisResults.slot_detections && analysisResults.slot_detections.length > 0) {
        const inferencePayload = InferenceEventService.buildPayloadFromAnalysisResults(analysisResults, {
          parkingLotId,
          processingJobId: aiProcessingJobId,
          inputPath: videoPath,
          modelName: 'yolov8_parking_slot',
          notes: `Automatically generated from video analysis ${analysisId}.`
        });
        inferenceResult = await InferenceEventService.recordInferenceEvent(inferencePayload, io);
        analysisResults.inference_event_id = inferenceResult.inference_event.id;
        analysisResults.standard_inference_result = inferencePayload;
      } else if (aiProcessingJobId) {
        await AiProcessingJobService.updateStatus(aiProcessingJobId, {
          status: 'completed',
          progress_percent: 100,
          metadata: {
            video_analysis_id: analysisId,
            detections_written: 0,
            completed_without_inference_event: true
          }
        });
      }

      // Complete the analysis
      await videoAnalysis.complete(analysisResults);

      // Emit processing completed event
      io.to(`parking-lot-${parkingLotId}`).emit('video-processing-completed', {
        analysis_id: analysisId,
        ai_processing_job_id: aiProcessingJobId,
        status: 'completed',
        results: analysisResults,
        inference_event: inferenceResult?.inference_event || null,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Video analysis ${analysisId} completed successfully`);

    } catch (error) {
      console.error(`❌ Video analysis ${analysisId} failed:`, error);

      try {
        if (videoAnalysis) {
          await videoAnalysis.fail(error.message);
        }

        if (aiProcessingJobId) {
          await AiProcessingJobService.markFailed(aiProcessingJobId, error.message);
        }

        // Emit processing failed event
        io.to(`parking-lot-${parkingLotId}`).emit('video-processing-failed', {
          analysis_id: analysisId,
          ai_processing_job_id: aiProcessingJobId,
          status: 'failed',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      } catch (updateError) {
        console.error('Error updating failed analysis:', updateError);
      }
    } finally {
      // Clean up video file after processing
      try {
        if (fs.existsSync(videoPath)) {
          fs.unlinkSync(videoPath);
          console.log(`🗑️  Cleaned up video file: ${videoPath}`);
        }
      } catch (cleanupError) {
        console.error('Error cleaning up video file:', cleanupError);
      }
    }
  }

  // Get analysis results
  static async getAnalysisResults(req, res) {
    try {
      const { analysisId } = req.params;
      
      if (!analysisId || isNaN(analysisId)) {
        return res.status(400).json({
          error: 'Invalid analysis ID'
        });
      }

      const videoAnalysis = await VideoAnalysis.findById(parseInt(analysisId));
      if (!videoAnalysis) {
        return res.status(404).json({
          error: 'Video analysis not found'
        });
      }

      res.json({
        success: true,
        data: videoAnalysis.toJSON()
      });
    } catch (error) {
      console.error('Error getting analysis results:', error);
      res.status(500).json({
        error: 'Failed to get analysis results',
        message: error.message
      });
    }
  }

  // Get all analyses for a parking lot
  static async getLotAnalyses(req, res) {
    try {
      const { lotId } = req.params;
      const limit = parseInt(req.query.limit) || 20;
      
      if (!lotId || isNaN(lotId)) {
        return res.status(400).json({
          error: 'Invalid parking lot ID'
        });
      }

      const analyses = await VideoAnalysis.findByLotId(parseInt(lotId), limit);

      res.json({
        success: true,
        data: {
          analyses: analyses.map(analysis => analysis.toJSON()),
          count: analyses.length
        }
      });
    } catch (error) {
      console.error('Error getting lot analyses:', error);
      res.status(500).json({
        error: 'Failed to get lot analyses',
        message: error.message
      });
    }
  }

  // Get processing queue status
  static async getProcessingQueue(req, res) {
    try {
      const pendingAnalyses = await VideoAnalysis.findByStatus('pending');
      const processingAnalyses = await VideoAnalysis.findByStatus('processing');
      const stats = await VideoAnalysis.getProcessingStats();

      res.json({
        success: true,
        data: {
          queue: {
            pending: pendingAnalyses.length,
            processing: processingAnalyses.length,
            pending_analyses: pendingAnalyses.map(analysis => analysis.toJSON()),
            processing_analyses: processingAnalyses.map(analysis => analysis.toJSON())
          },
          statistics: stats
        }
      });
    } catch (error) {
      console.error('Error getting processing queue:', error);
      res.status(500).json({
        error: 'Failed to get processing queue',
        message: error.message
      });
    }
  }

  // Cancel video analysis
  static async cancelAnalysis(req, res) {
    try {
      const { analysisId } = req.params;
      
      if (!analysisId || isNaN(analysisId)) {
        return res.status(400).json({
          error: 'Invalid analysis ID'
        });
      }

      const videoAnalysis = await VideoAnalysis.findById(parseInt(analysisId));
      if (!videoAnalysis) {
        return res.status(404).json({
          error: 'Video analysis not found'
        });
      }

      // Can only cancel pending analyses
      if (videoAnalysis.processing_status !== 'pending') {
        return res.status(409).json({
          error: 'Can only cancel pending analyses',
          current_status: videoAnalysis.processing_status
        });
      }

      await videoAnalysis.fail('Cancelled by user');

      // Emit cancellation event
      req.io.to(`parking-lot-${videoAnalysis.parking_lot_id}`).emit('video-processing-cancelled', {
        analysis_id: videoAnalysis.id,
        status: 'failed',
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        message: 'Video analysis cancelled successfully',
        data: videoAnalysis.toJSON()
      });
    } catch (error) {
      console.error('Error cancelling analysis:', error);
      res.status(500).json({
        error: 'Failed to cancel analysis',
        message: error.message
      });
    }
  }

  // Get recent analyses across all lots
  static async getRecentAnalyses(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const analyses = await VideoAnalysis.getRecentWithLotInfo(limit);

      res.json({
        success: true,
        data: {
          analyses: analyses,
          count: analyses.length
        }
      });
    } catch (error) {
      console.error('Error getting recent analyses:', error);
      res.status(500).json({
        error: 'Failed to get recent analyses',
        message: error.message
      });
    }
  }

  // Delete analysis record
  static async deleteAnalysis(req, res) {
    try {
      const { analysisId } = req.params;
      
      if (!analysisId || isNaN(analysisId)) {
        return res.status(400).json({
          error: 'Invalid analysis ID'
        });
      }

      const videoAnalysis = await VideoAnalysis.findById(parseInt(analysisId));
      if (!videoAnalysis) {
        return res.status(404).json({
          error: 'Video analysis not found'
        });
      }

      // Allow force delete even if processing: mark failed then delete
      if (videoAnalysis.processing_status === 'processing') {
        try {
          await videoAnalysis.fail('Force deleted by admin');
        } catch (_) {
          // ignore failure to mark failed; proceed to delete
        }
      }

      await videoAnalysis.delete();

      res.json({
        success: true,
        message: 'Video analysis deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting analysis:', error);
      res.status(500).json({
        error: 'Failed to delete analysis',
        message: error.message
      });
    }
  }

  // Test video processing (with mock data)
  static async testVideoProcessing(req, res) {
    try {
      const { lotId } = req.params;
      
      if (!lotId || isNaN(lotId)) {
        return res.status(400).json({
          error: 'Invalid parking lot ID'
        });
      }

      // Verify parking lot exists
      const parkingLot = await ParkingLot.findById(parseInt(lotId));
      if (!parkingLot) {
        return res.status(404).json({
          error: 'Parking lot not found'
        });
      }

      // Create mock analysis record
      const videoAnalysis = await VideoAnalysis.create({
        parking_lot_id: parseInt(lotId),
        video_filename: 'test-video.mp4',
        processing_status: 'pending',
        analysis_data: {
          analysis_type: 'test',
          file_info: {
            original_name: 'test-video.mp4',
            size: 1024000,
            mimetype: 'video/mp4'
          }
        }
      });

      const aiProcessingJob = await AiProcessingJobService.createJob({
        parking_lot_id: parseInt(lotId),
        job_type: 'manual_demo',
        input_path: 'test-video.mp4',
        model_name: 'mock_video_analysis',
        status: 'queued',
        metadata: {
          video_analysis_id: videoAnalysis.id,
          source: 'test_processing_endpoint'
        },
        notes: `Generated by /api/video/test-processing/${lotId}. Demo-only mock processing.`
      });

      // Simulate processing with mock results
      setTimeout(async () => {
        try {
          await videoAnalysis.startProcessing();
          await AiProcessingJobService.updateStatus(aiProcessingJob.id, {
            status: 'processing',
            progress_percent: 30,
            metadata: {
              video_analysis_id: videoAnalysis.id,
              processing_started_at: new Date().toISOString()
            }
          });
          
          // Get current slots
          const slots = await ParkingSlot.findByLotId(parseInt(lotId));
          
          // Generate mock detection results
          const mockResults = {
            video_filename: 'test-video.mp4',
            processing_time: 15.5,
            total_frames: 300,
            vehicle_count: Math.floor(Math.random() * slots.length * 0.7),
            slot_detections: slots.map(slot => ({
              slot_id: slot.id,
              slot_number: slot.slot_number,
              is_occupied: Math.random() < 0.4, // 40% occupancy
              confidence: 0.85 + Math.random() * 0.15,
              predicted_duration: Math.floor(Math.random() * 3600) + 300 // 5-65 minutes
            }))
          };

          const inferencePayload = InferenceEventService.buildPayloadFromAnalysisResults(mockResults, {
            parkingLotId: parseInt(lotId),
            processingJobId: aiProcessingJob.id,
            inputPath: 'test-video.mp4',
            modelName: 'mock_video_analysis',
            notes: `Generated by /api/video/test-processing/${lotId}.`
          });
          const inferenceResult = await InferenceEventService.recordInferenceEvent(inferencePayload, req.io);
          mockResults.inference_event_id = inferenceResult.inference_event.id;
          mockResults.standard_inference_result = inferencePayload;

          // Complete analysis
          await videoAnalysis.complete(mockResults);

          // Emit updates
          req.io.to(`parking-lot-${lotId}`).emit('video-processing-completed', {
            analysis_id: videoAnalysis.id,
            ai_processing_job_id: aiProcessingJob.id,
            status: 'completed',
            results: mockResults,
            inference_event: inferenceResult.inference_event,
            timestamp: new Date().toISOString()
          });

        } catch (error) {
          console.error('Error in test processing:', error);
          await videoAnalysis.fail(error.message);
          await AiProcessingJobService.markFailed(aiProcessingJob.id, error.message);
        }
      }, 2000); // 2 second delay to simulate processing

      res.json({
        success: true,
        message: 'Test video processing started',
        data: {
          analysis_id: videoAnalysis.id,
          ai_processing_job_id: aiProcessingJob.id,
          ai_processing_job_external_id: aiProcessingJob.job_external_id,
          processing_status: 'pending',
          parking_lot_id: parseInt(lotId)
        }
      });
    } catch (error) {
      console.error('Error starting test processing:', error);
      res.status(500).json({
        error: 'Failed to start test processing',
        message: error.message
      });
    }
  }
}

module.exports = VideoController;
