const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/adminController');

// Authentication routes
router.post('/login', AdminController.login);
router.post('/create-user', AdminController.createUser);

// Parking lot management
router.post('/parking-lots', AdminController.createParkingLot);
router.put('/parking-lots/:lotId', AdminController.updateParkingLot);
router.delete('/parking-lots/:lotId', AdminController.deleteParkingLot);

// Analytics routes
router.get('/analytics/system', AdminController.getSystemAnalytics);
router.get('/analytics/parking-lot/:lotId', AdminController.getParkingLotAnalytics);

// Camera/source management
router.get('/camera-sources', AdminController.getCameraSources);

// AI inference result ingestion
router.get('/inference-events', AdminController.getInferenceEvents);
router.post('/inference-events', AdminController.submitInferenceEvent);
router.get('/ai-processing-jobs', AdminController.getAiProcessingJobs);
router.post('/ai-processing-jobs', AdminController.createAiProcessingJob);
router.post('/ai-processing-jobs/demo-infer', AdminController.runDemoAiModelInference);
router.post('/ai-processing-jobs/:jobId/rerun', AdminController.rerunAiProcessingJob);
router.put('/ai-processing-jobs/:jobId/status', AdminController.updateAiProcessingJobStatus);

// Open data provenance and import monitoring
router.get('/data-sources', AdminController.getDataSources);
router.get('/open-data-import-jobs', AdminController.getOpenDataImportJobs);
router.get('/open-data-occupancy-snapshots', AdminController.getOpenDataOccupancySnapshots);
router.get('/parking-lot-candidates', AdminController.getParkingLotCandidates);
router.put('/parking-lot-candidates/:candidateId/review', AdminController.updateParkingLotCandidateReview);
router.get('/parking-operations', AdminController.getParkingOperations);
router.get('/governance/summary', AdminController.getGovernanceSummary);

// System configuration
router.get('/configuration', AdminController.getSystemConfiguration);
router.put('/configuration', AdminController.updateSystemConfiguration);

// User management
router.get('/users', AdminController.getAllUsers);
router.put('/users/:userId', AdminController.updateUser);
router.delete('/users/:userId', AdminController.deleteUser);

// Reports
router.get('/reports', AdminController.generateSystemReport);

module.exports = router;
