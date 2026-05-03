const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

const readJson = async (response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON response but received: ${text.slice(0, 180)}`);
  }
};

const requestJson = async (path, options = {}) => {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} returned ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
};

const expect = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const getParkingLots = (payload) => {
  const data = payload?.data;
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.parking_lots)) {
    return data.parking_lots;
  }

  return [];
};

const summarizeArrayCount = (payload, key) => {
  const items = payload?.data?.[key];
  return Array.isArray(items) ? items.length : 0;
};

const runCheck = async (name, fn) => {
  const startedAt = Date.now();
  const result = await fn();
  const durationMs = Date.now() - startedAt;
  console.log(`ok ${name} (${durationMs}ms)${result ? `: ${result}` : ''}`);
};

const main = async () => {
  console.log(`Running API smoke check against ${baseUrl}`);

  let token = '';
  let firstParkingLotId = null;
  let arrivalIntentDisplayCode = '';

  await runCheck('health', async () => {
    const payload = await requestJson('/health');
    expect(payload?.status === 'OK', 'Health endpoint did not return status OK');
    return payload.environment || 'unknown environment';
  });

  await runCheck('admin login', async () => {
    const payload = await requestJson('/admin/login', {
      method: 'POST',
      body: {
        username: adminUsername,
        password: adminPassword
      }
    });

    token = payload?.data?.token;
    expect(payload?.success === true && token, 'Admin login did not return a token');
    return `user=${payload.data.user?.username || adminUsername}`;
  });

  await runCheck('parking lots', async () => {
    const payload = await requestJson('/parking/lots');
    expect(payload?.success === true, 'Parking lots endpoint did not return success=true');
    const parkingLots = getParkingLots(payload);
    expect(parkingLots.length > 0, 'Parking lots endpoint returned no parking lots');
    firstParkingLotId = parkingLots[0].id;
    expect(firstParkingLotId, 'First parking lot has no id');
    return `${parkingLots.length} lots`;
  });

  await runCheck('parking status', async () => {
    const payload = await requestJson(`/parking/status/${firstParkingLotId}`);
    expect(payload?.success === true, 'Parking status endpoint did not return success=true');
    const slots = payload?.data?.slots || [];
    expect(Array.isArray(slots), 'Parking status response does not include a slots array');
    return `${slots.length} slots`;
  });

  await runCheck('parking recommendations', async () => {
    const payload = await requestJson('/parking/recommendations?limit=3');
    expect(payload?.success === true, 'Parking recommendations endpoint did not return success=true');
    const recommendations = payload?.data?.recommendations || [];
    expect(Array.isArray(recommendations), 'Parking recommendations response does not include a recommendations array');
    expect(recommendations.length > 0, 'Parking recommendations returned no lots');
    expect(typeof recommendations[0].probability === 'number', 'First recommendation has no probability');
    return `${recommendations.length} recommendations`;
  });

  await runCheck('arrival intent demo', async () => {
    const payload = await requestJson('/parking/arrival-intents', {
      method: 'POST',
      body: {
        lot_id: firstParkingLotId,
        estimated_arrival_minutes: 15,
        expected_duration_minutes: 120
      }
    });
    expect(payload?.success === true, 'Arrival intent endpoint did not return success=true');
    expect(payload?.data?.display_code, 'Arrival intent response did not include display_code');
    arrivalIntentDisplayCode = payload.data.display_code;
    return arrivalIntentDisplayCode;
  });

  await runCheck('arrival intent receipt lookup', async () => {
    const payload = await requestJson(`/parking/arrival-intents/${encodeURIComponent(arrivalIntentDisplayCode)}`);
    expect(payload?.success === true, 'Arrival intent receipt lookup did not return success=true');
    expect(payload?.data?.display_code === arrivalIntentDisplayCode, 'Arrival intent lookup returned a different code');
    return payload.data.status;
  });

  await runCheck('admin data sources', async () => {
    const payload = await requestJson('/admin/data-sources', { token });
    expect(payload?.success === true, 'Data sources endpoint did not return success=true');
    return `${payload?.data?.count ?? summarizeArrayCount(payload, 'data_sources')} sources`;
  });

  await runCheck('admin camera sources', async () => {
    const payload = await requestJson('/admin/camera-sources', { token });
    expect(payload?.success === true, 'Camera sources endpoint did not return success=true');
    return `${payload?.data?.count ?? summarizeArrayCount(payload, 'camera_sources')} sources`;
  });

  await runCheck('admin inference events', async () => {
    const payload = await requestJson('/admin/inference-events?limit=1', { token });
    expect(payload?.success === true, 'Inference events endpoint did not return success=true');
    return `${payload?.data?.count ?? summarizeArrayCount(payload, 'inference_events')} events`;
  });

  await runCheck('admin AI processing jobs', async () => {
    const payload = await requestJson('/admin/ai-processing-jobs?limit=1', { token });
    expect(payload?.success === true, 'AI processing jobs endpoint did not return success=true');
    return `${payload?.data?.count ?? summarizeArrayCount(payload, 'ai_processing_jobs')} jobs`;
  });

  await runCheck('admin arrival intents', async () => {
    const payload = await requestJson('/admin/arrival-intents?limit=3', { token });
    expect(payload?.success === true, 'Arrival intents endpoint did not return success=true');
    const intents = payload?.data?.arrival_intents || [];
    expect(Array.isArray(intents), 'Arrival intents response does not include an arrival_intents array');
    return `${intents.length} intents, ${payload?.data?.summary?.active ?? 0} active`;
  });

  await runCheck('admin expire arrival intents', async () => {
    const payload = await requestJson('/admin/arrival-intents/expire', {
      method: 'POST',
      token
    });
    expect(payload?.success === true, 'Expire arrival intents endpoint did not return success=true');
    return `${payload?.data?.expired_count ?? 0} expired`;
  });

  await runCheck('admin parking lot candidates', async () => {
    const payload = await requestJson('/admin/parking-lot-candidates?limit=1', { token });
    expect(payload?.success === true, 'Parking lot candidates endpoint did not return success=true');
    return `${payload?.data?.count ?? summarizeArrayCount(payload, 'parking_lot_candidates')} candidates`;
  });

  await runCheck('admin parking operations', async () => {
    const payload = await requestJson('/admin/parking-operations', { token });
    expect(payload?.success === true, 'Parking operations endpoint did not return success=true');
    const operations = payload?.data?.parking_operations || [];
    expect(Array.isArray(operations), 'Parking operations response does not include a parking_operations array');
    return `${operations.length} lots, ${payload?.data?.summary?.high_occupancy_lots ?? 0} high occupancy`;
  });

  await runCheck('admin governance summary', async () => {
    const payload = await requestJson('/admin/governance/summary', { token });
    expect(payload?.success === true, 'Governance summary endpoint did not return success=true');
    const districts = payload?.data?.districts || [];
    expect(Array.isArray(districts), 'Governance summary response does not include a districts array');
    return `${districts.length} districts`;
  });

  console.log('API smoke check passed');
};

main().catch((error) => {
  console.error('API smoke check failed');
  console.error(error.message);
  console.error(`Make sure the backend is running, for example: PORT=3000 NODE_ENV=development npm run dev`);
  process.exit(1);
});
