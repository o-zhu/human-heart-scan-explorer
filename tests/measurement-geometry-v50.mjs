import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {measurementGeometry, measurementDistanceMm, projectMeasurementPoint} from '../public/measurement-geometry.js';
import {volumeGeometry, projectProbePoint} from '../public/probe-geometry.js';
import {sourceToWorld} from '../public/planes.js';

test('source centre spacing gives physical millimeters, including anisotropic grids', () => {
  const meta = {dimensions: [101, 61, 81], spacingUm: [1000, 2000, 500]};
  const geometry = measurementGeometry(meta), expected = volumeGeometry(meta);
  assert.deepEqual(geometry.sizeMm, [100, 120, 40]);
  assert.equal(geometry.longestMm, expected.longestMm);
  for (let axis = 0; axis < 3; axis++) {
    const a = [.5, .5, .5], b = [...a]; b[axis] += .25;
    const distance = measurementDistanceMm(sourceToWorld(a, expected.extent), sourceToWorld(b, expected.extent), geometry);
    assert.ok(Math.abs(distance - geometry.sizeMm[axis] / 4) < 1e-10);
  }
});

test('diagonal distance is Euclidean and independent of camera or apparent screen length', () => {
  const g = measurementGeometry({dimensions:[101,101,101],spacingUm:1000});
  assert.ok(Math.abs(measurementDistanceMm([0,0,0],[.03,.04,.12],g)-13)<1e-10);
  assert.ok(Math.abs(measurementDistanceMm([.03,.04,.12],[0,0,0],g)-13)<1e-10);
});

test('the actual LADAF overview and high grid share one physical scale', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url)));
  const high = measurementGeometry(manifest.levels.high);
  assert.ok(Math.abs(high.longestMm - 168.0104) < 1e-10);
  for (const meta of Object.values(manifest.levels)) {
    const geometry = measurementGeometry(meta);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(geometry.sizeMm[i] - high.sizeMm[i]) < 1e-5);
  }
});

test('projection agrees with the established shared camera projection at varied aspect ratios', () => {
  const basis = {eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};
  for (const [width,height] of [[1400,800],[390,700],[800,390]]) {
    for (const point of [[0,0,0],[.1,-.1,.25],[-.2,.3,-.1]]) {
      const measured = projectMeasurementPoint(point,basis,width,height);
      const shared = projectProbePoint(point,basis,width,height);
      assert.ok(Math.abs(measured.x - shared.x) < 1e-10);
      assert.ok(Math.abs(measured.y - shared.y) < 1e-10);
    }
  }
  assert.equal(projectMeasurementPoint([0,0,3],basis,800,600),null);
  assert.equal(projectMeasurementPoint([0,0,0],basis,0,600),null);
});

test('missing or invalid physical metadata cannot create a plausible millimeter result', () => {
  for (const meta of [null,{}, {dimensions:[1,2,3],spacingUm:10}, {dimensions:[2,3,4],spacingUm:0}, {dimensions:[2,3,4],spacingUm:[1,2]}, {dimensions:[Infinity,3,4],spacingUm:10}]) assert.equal(measurementGeometry(meta),null);
  assert.equal(measurementDistanceMm([0,0,0],[1,1,1],null),null);
  assert.equal(measurementDistanceMm([NaN,0,0],[1,1,1],{longestMm:100}),null);
});
