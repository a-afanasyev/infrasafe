import schedule from 'node-schedule';
import { getAllRanges } from './store.js';
import { postMetric, getBuildingsWithControllers } from './apiClient.js';

function randomInRange(min, max) {
  const mi = Number(min);
  const ma = Number(max);
  if (!Number.isFinite(mi) || !Number.isFinite(ma)) return null;
  return +(mi + Math.random() * (ma - mi)).toFixed(2);
}

function buildMetricPayload(controllerId, ranges) {
  const electricity = ranges?.electricity || {};
  const amperage = ranges?.amperage || {};
  const waterP = ranges?.waterPressure || {};
  const waterT = ranges?.waterTemp || {};
  const env = ranges?.environment || {};
  const leakProbability = Number(ranges?.leakProbability || 0);

  return {
    controller_id: controllerId,
    timestamp: new Date().toISOString(),
    electricity_ph1: randomInRange(electricity?.ph1?.[0], electricity?.ph1?.[1]),
    electricity_ph2: randomInRange(electricity?.ph2?.[0], electricity?.ph2?.[1]),
    electricity_ph3: randomInRange(electricity?.ph3?.[0], electricity?.ph3?.[1]),
    amperage_ph1: randomInRange(amperage?.ph1?.[0], amperage?.ph1?.[1]),
    amperage_ph2: randomInRange(amperage?.ph2?.[0], amperage?.ph2?.[1]),
    amperage_ph3: randomInRange(amperage?.ph3?.[0], amperage?.ph3?.[1]),
    cold_water_pressure: randomInRange(waterP?.cold?.[0], waterP?.cold?.[1]),
    cold_water_temp: randomInRange(waterT?.cold?.[0], waterT?.cold?.[1]),
    hot_water_in_pressure: randomInRange(waterP?.hotIn?.[0], waterP?.hotIn?.[1]),
    hot_water_out_pressure: randomInRange(waterP?.hotOut?.[0], waterP?.hotOut?.[1]),
    hot_water_in_temp: randomInRange(waterT?.hotIn?.[0], waterT?.hotIn?.[1]),
    hot_water_out_temp: randomInRange(waterT?.hotOut?.[0], waterT?.hotOut?.[1]),
    air_temp: randomInRange(env?.airTemp?.[0], env?.airTemp?.[1]),
    humidity: randomInRange(env?.humidity?.[0], env?.humidity?.[1]),
    leak_sensor: Math.random() < leakProbability
  };
}

export async function runOnce() {
  const rangesByBuildingId = getAllRanges();
  const buildings = await getBuildingsWithControllers();

  const results = [];
  for (const b of buildings) {
    const buildingId = String(b.building_id);
    const ranges = rangesByBuildingId[buildingId];
    if (!ranges) continue;

    const payload = buildMetricPayload(b.controller_id, ranges);
    try {
      const resp = await postMetric(payload);
      results.push({ buildingId, controllerId: b.controller_id, ok: true, id: resp?.metric_id || null });
    } catch (e) {
      results.push({ buildingId, controllerId: b.controller_id, ok: false, error: e?.message });
    }
  }
  return results;
}

export function startScheduler() {
  const cron = process.env.GENERATOR_CRON || '*/2 * * * *';
  schedule.scheduleJob(cron, async () => {
    try {
      await runOnce();
    } catch {
      // без падения процесса
    }
  });
}
