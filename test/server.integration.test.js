'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const sharp = require('sharp');

const repoRoot = path.resolve(__dirname, '..');
const tinyPngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2M3xkAAAAASUVORK5CYII=',
  'base64'
);

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
    server.on('error', reject);
  });
}

function getSetCookie(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }

  const header = response.headers.get('set-cookie');
  return header ? [header] : [];
}

function createCookieJar() {
  const store = new Map();

  return {
    addFromResponse(response) {
      for (const rawCookie of getSetCookie(response)) {
        const firstPart = rawCookie.split(';', 1)[0];
        const separator = firstPart.indexOf('=');
        if (separator === -1) continue;
        const name = firstPart.slice(0, separator).trim();
        const value = firstPart.slice(separator + 1).trim();
        if (!value) {
          store.delete(name);
          continue;
        }
        store.set(name, value);
      }
    },
    header() {
      return [...store.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    }
  };
}

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health/live`);
      if (response.ok) return;
    } catch {
      // Server is still booting.
    }

    await delay(100);
  }

  throw new Error('Server did not become ready in time.');
}

async function startServer() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'hochzeit-app-test-'));
  const dataDir = path.join(tempRoot, 'data');
  const storageDir = path.join(tempRoot, 'storage');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(storageDir, { recursive: true });

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      STORAGE_DIR: storageDir,
      DB_PATH: path.join(dataDir, 'platform.sqlite'),
      OPERATOR_PASSWORD: 'operator-secret',
      ALLOW_FREE_SPACE_CREATION: '1',
      UPLOAD_REQUEST_TIMEOUT_MS: '0',
      UPLOAD_LIMITER_MAX: '0',
      GUEST_ROUTE_LIMITER_MAX: '0',
      FILE_LIMITER_MAX: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  await waitForServer(baseUrl, child);

  return {
    baseUrl,
    dataDir,
    storageDir,
    stdout: () => stdout,
    stderr: () => stderr,
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise(resolve => child.once('exit', resolve));
      }
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  };
}

async function postJson(url, payload, { headers = {}, cookieJar } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookieJar?.header() ? { Cookie: cookieJar.header() } : {}),
      ...headers
    },
    body: JSON.stringify(payload)
  });

  cookieJar?.addFromResponse(response);
  return response;
}

async function uploadPhoto(url, { deviceId, comment, cookieJar } = {}) {
  const photoBuffer = tinyPngBuffer;
  const photoType = 'image/png';
  const photoName = 'tiny.png';

  return uploadCustomPhoto(url, {
    deviceId,
    comment,
    cookieJar,
    photoBuffer,
    photoType,
    photoName
  });
}

async function uploadCustomPhoto(url, { deviceId, comment, cookieJar, photoBuffer, photoType, photoName, uploaderInfo } = {}) {
  const form = new FormData();
  form.append('photo', new Blob([photoBuffer], { type: photoType }), photoName);
  form.append('device_id', deviceId);
  form.append('comment', comment || 'Ein Testfoto');
  form.append('uploader_info', JSON.stringify(uploaderInfo || { browser: 'node-test', os: 'test-os', device: 'test-device' }));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Device-Id': deviceId,
      ...(cookieJar?.header() ? { Cookie: cookieJar.header() } : {})
    },
    body: form
  });

  cookieJar?.addFromResponse(response);
  return response;
}

async function createOrientedJpegBuffer() {
  return sharp({
    create: {
      width: 40,
      height: 80,
      channels: 3,
      background: { r: 220, g: 120, b: 80 }
    }
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

async function createSelfServeSpace(baseUrl) {
  const response = await postJson(`${baseUrl}/api/spaces`, {
    partnerOneName: 'Anna',
    partnerTwoName: 'Ben',
    weddingDate: '2026-05-03',
    ownerEmail: 'anna@example.com',
    adminPassword: 'Brautpaar123'
  });

  assert.equal(response.status, 201);
  return response.json();
}

test('demo route creates a directly usable demo space', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/demo`, {
      redirect: 'manual'
    });
    assert.equal(response.status, 302);

    const location = response.headers.get('location');
    assert.match(location, /^\/p\/[A-Za-z0-9_-]{8}\/[-_A-Za-z0-9]{16}$/);

    const configResponse = await fetch(`${server.baseUrl}${location}/api/config`);
    assert.equal(configResponse.status, 200);
    const config = await configResponse.json();
    assert.equal(config.demoMode, true);
  } finally {
    await server.stop();
  }
});

test('health endpoint reports ready state for isolated runtime directories', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.uploadLimitMb, null);
    assert.equal(payload.uploadRequestTimeoutMs, 0);
    assert.equal(payload.checks.database.ok, true);
    assert.equal(payload.checks.dataDir.ok, true);
    assert.equal(payload.checks.storageDir.ok, true);
    assert.equal(payload.checks.spacesDir.ok, true);

    const plansResponse = await fetch(`${server.baseUrl}/api/plans`);
    assert.equal(plansResponse.status, 200);
    const plans = await plansResponse.json();
    assert.equal(plans.checkoutEnabled, false);
    assert.deepEqual(plans.plans.map(plan => plan.id), ['basic', 'premium']);

    const checkoutResponse = await postJson(`${server.baseUrl}/api/checkout/start`, {
      partnerOneName: 'Anna',
      partnerTwoName: 'Ben',
      weddingDate: '2026-05-03',
      ownerEmail: 'anna@example.com',
      adminPassword: 'Brautpaar123',
      plan: 'basic'
    });
    assert.equal(checkoutResponse.status, 503);
  } finally {
    await server.stop();
  }
});

test('self-serve upload keeps original bytes untouched and owner can delete it', async () => {
  const server = await startServer();

  try {
    const createdSpace = await createSelfServeSpace(server.baseUrl);
    const operatorCookies = createCookieJar();
    const deviceId = '463fe0dc-891d-473e-bf52-be454fcb0b2b';

    const configResponse = await fetch(`${server.baseUrl}${createdSpace.guestPath}/api/config`);
    assert.equal(configResponse.status, 200);
    const config = await configResponse.json();
    assert.equal(createdSpace.displayName, 'Anna & Ben - 03.05.2026');
    assert.equal(config.space.displayName, 'Anna & Ben - 03.05.2026');
    assert.equal(config.space.coupleLabel, 'Anna & Ben');
    assert.equal(config.uploadLimitLabel, 'Originaldatei ohne Uploadlimit');
    assert.equal(config.uploadRequestTimeoutMs, 0);

    const loginResponse = await postJson(
      `${server.baseUrl}/api/operator/login`,
      { password: 'operator-secret' },
      { cookieJar: operatorCookies }
    );
    assert.equal(loginResponse.status, 200);

    const spacesResponse = await fetch(`${server.baseUrl}/api/operator/spaces`, {
      headers: { Cookie: operatorCookies.header() }
    });
    const spacesPayload = await spacesResponse.json();
    const spaceSummary = spacesPayload.spaces.find(space => space.publicId === createdSpace.guestPath.split('/')[2]);
    assert.ok(spaceSummary);

    const uploadResponse = await uploadPhoto(`${server.baseUrl}${createdSpace.guestPath}/api/upload`, {
      deviceId,
      comment: 'Originaldatei',
      cookieJar: null
    });
    assert.equal(uploadResponse.status, 201);
    const uploadedPhoto = await uploadResponse.json();

    const storedFilePath = path.join(server.storageDir, 'spaces', spaceSummary.id, 'uploads', uploadedPhoto.filename);
    assert.equal(fs.existsSync(storedFilePath), true);
    assert.deepEqual(await fsp.readFile(storedFilePath), tinyPngBuffer);

    const listResponse = await fetch(`${server.baseUrl}${createdSpace.guestPath}/api/photos`, {
      headers: { 'X-Device-Id': deviceId }
    });
    assert.equal(listResponse.status, 200);
    const listedPhotos = await listResponse.json();
    assert.equal(listedPhotos.length, 1);
    assert.equal(listedPhotos[0].isOwn, true);

    const deleteResponse = await fetch(`${server.baseUrl}${createdSpace.guestPath}/api/photos/${uploadedPhoto.id}`, {
      method: 'DELETE',
      headers: { 'X-Device-Id': deviceId }
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal(fs.existsSync(storedFilePath), false);
  } finally {
    await server.stop();
  }
});

test('upload accepts HEIC-labelled files and stores the original bytes untouched', async () => {
  const server = await startServer();

  try {
    const createdSpace = await createSelfServeSpace(server.baseUrl);
    const deviceId = '6b5d9876-891d-473e-bf52-be454fcb0b2b';
    const heicLikeBuffer = Buffer.from('not-a-real-heic-but-upload-filter-should-accept-it');

    const uploadResponse = await uploadCustomPhoto(`${server.baseUrl}${createdSpace.guestPath}/api/upload`, {
      deviceId,
      comment: 'HEIC Test',
      photoBuffer: heicLikeBuffer,
      photoType: 'image/heic',
      photoName: 'mobile-photo.heic'
    });
    assert.equal(uploadResponse.status, 201);
    const uploadedPhoto = await uploadResponse.json();

    const configResponse = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'operator-secret' })
    });
    assert.equal(configResponse.status, 200);

    const spacesResponse = await fetch(`${server.baseUrl}/api/operator/spaces`, {
      headers: { Cookie: configResponse.headers.get('set-cookie') || '' }
    });
    const spacesPayload = await spacesResponse.json();
    const spaceSummary = spacesPayload.spaces.find(space => space.publicId === createdSpace.guestPath.split('/')[2]);
    assert.ok(spaceSummary);

    const storedFilePath = path.join(server.storageDir, 'spaces', spaceSummary.id, 'uploads', uploadedPhoto.filename);
    assert.deepEqual(await fsp.readFile(storedFilePath), heicLikeBuffer);
  } finally {
    await server.stop();
  }
});

test('upload accepts MP4-labelled files and stores the original bytes untouched', async () => {
  const server = await startServer();

  try {
    const createdSpace = await createSelfServeSpace(server.baseUrl);
    const deviceId = '9e8f2876-891d-473e-bf52-be454fcb0b2b';
    const videoLikeBuffer = Buffer.from('not-a-real-mp4-but-upload-filter-should-accept-it');

    const uploadResponse = await uploadCustomPhoto(`${server.baseUrl}${createdSpace.guestPath}/api/upload`, {
      deviceId,
      comment: 'Video Test',
      photoBuffer: videoLikeBuffer,
      photoType: 'video/mp4',
      photoName: 'dance-floor.mp4'
    });
    assert.equal(uploadResponse.status, 201);
    const uploadedPhoto = await uploadResponse.json();

    const photosResponse = await fetch(`${server.baseUrl}${createdSpace.guestPath}/api/photos`, {
      headers: { 'X-Device-Id': deviceId }
    });
    assert.equal(photosResponse.status, 200);
    const photos = await photosResponse.json();

    assert.equal(photos.length, 1);
    assert.equal(photos[0].original_name, 'dance-floor.mp4');

    const configResponse = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'operator-secret' })
    });
    assert.equal(configResponse.status, 200);

    const spacesResponse = await fetch(`${server.baseUrl}/api/operator/spaces`, {
      headers: { Cookie: configResponse.headers.get('set-cookie') || '' }
    });
    const spacesPayload = await spacesResponse.json();
    const spaceSummary = spacesPayload.spaces.find(space => space.publicId === createdSpace.guestPath.split('/')[2]);
    assert.ok(spaceSummary);

    const storedFilePath = path.join(server.storageDir, 'spaces', spaceSummary.id, 'uploads', uploadedPhoto.filename);
    assert.deepEqual(await fsp.readFile(storedFilePath), videoLikeBuffer);
  } finally {
    await server.stop();
  }
});

test('gallery thumbnails are auto-rotated from EXIF orientation metadata', async () => {
  const server = await startServer();

  try {
    const createdSpace = await createSelfServeSpace(server.baseUrl);
    const deviceId = '7c6e0876-891d-473e-bf52-be454fcb0b2b';
    const orientedJpegBuffer = await createOrientedJpegBuffer();

    const uploadResponse = await uploadCustomPhoto(`${server.baseUrl}${createdSpace.guestPath}/api/upload`, {
      deviceId,
      comment: 'EXIF Rotation',
      photoBuffer: orientedJpegBuffer,
      photoType: 'image/jpeg',
      photoName: 'portrait.jpg'
    });
    assert.equal(uploadResponse.status, 201);
    const uploadedPhoto = await uploadResponse.json();

    const thumbResponse = await fetch(`${server.baseUrl}${createdSpace.guestPath}/uploads/${encodeURIComponent(uploadedPhoto.filename)}?thumb=1`);
    assert.equal(thumbResponse.status, 200);
    assert.match(thumbResponse.headers.get('content-type') || '', /image\/webp/);

    const thumbBuffer = Buffer.from(await thumbResponse.arrayBuffer());
    const thumbMetadata = await sharp(thumbBuffer).metadata();
    assert.ok(thumbMetadata.width > thumbMetadata.height);
  } finally {
    await server.stop();
  }
});

test('optional uploader name is stored in photo metadata', async () => {
  const server = await startServer();

  try {
    const createdSpace = await createSelfServeSpace(server.baseUrl);
    const adminCookies = createCookieJar();
    const deviceId = '8d7f1876-891d-473e-bf52-be454fcb0b2b';

    const uploadResponse = await uploadCustomPhoto(`${server.baseUrl}${createdSpace.guestPath}/api/upload`, {
      deviceId,
      comment: 'Mit Namen',
      photoBuffer: tinyPngBuffer,
      photoType: 'image/png',
      photoName: 'named-upload.png',
      uploaderInfo: {
        name: 'Lisa',
        browser: 'node-test',
        os: 'test-os',
        device: 'test-device'
      }
    });
    assert.equal(uploadResponse.status, 201);

    const adminLoginResponse = await postJson(
      `${server.baseUrl}${createdSpace.guestPath}/api/admin/login`,
      { password: createdSpace.adminPassword },
      { cookieJar: adminCookies }
    );
    assert.equal(adminLoginResponse.status, 200);

    const adminPhotosResponse = await fetch(`${server.baseUrl}${createdSpace.guestPath}/api/admin/photos?scope=active`, {
      headers: { Cookie: adminCookies.header() }
    });
    assert.equal(adminPhotosResponse.status, 200);
    const adminPhotos = await adminPhotosResponse.json();

    assert.equal(adminPhotos.length, 1);
    assert.match(adminPhotos[0].uploader_summary || '', /^Lisa(\s|·|$)/);
  } finally {
    await server.stop();
  }
});

test('admin and operator flows can be exercised independently', async () => {
  const server = await startServer();

  try {
    const createdSpace = await createSelfServeSpace(server.baseUrl);
    const adminCookies = createCookieJar();
    const operatorCookies = createCookieJar();
    const deviceId = '563fe0dc-891d-473e-bf52-be454fcb0b2b';

    const firstUploadResponse = await uploadPhoto(`${server.baseUrl}${createdSpace.guestPath}/api/upload`, {
      deviceId,
      comment: 'Erstes Admin-Foto'
    });
    assert.equal(firstUploadResponse.status, 201);
    const firstPhoto = await firstUploadResponse.json();

    const adminLoginResponse = await postJson(
      `${server.baseUrl}${createdSpace.guestPath}/api/admin/login`,
      { password: createdSpace.adminPassword },
      { cookieJar: adminCookies }
    );
    assert.equal(adminLoginResponse.status, 200);

    const guestAccessResponse = await fetch(`${server.baseUrl}${createdSpace.guestPath}/api/admin/guest-access`, {
      headers: { Cookie: adminCookies.header() }
    });
    assert.equal(guestAccessResponse.status, 200);
    const guestAccessPayload = await guestAccessResponse.json();
    assert.equal(guestAccessPayload.guestUrl, `${server.baseUrl}${createdSpace.guestPath}`);
    assert.equal(guestAccessPayload.qrPrintUrl, `${createdSpace.guestPath}/api/admin/qr-print`);

    const exportResponse = await fetch(`${server.baseUrl}${createdSpace.guestPath}/api/admin/export.zip`, {
      headers: { Cookie: adminCookies.header() }
    });
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-type') || '', /application\/zip/);
    assert.match(exportResponse.headers.get('content-disposition') || '', /attachment; filename=/);
    const exportBuffer = Buffer.from(await exportResponse.arrayBuffer());
    assert.ok(exportBuffer.length > 0);

    const adminPhotosResponse = await fetch(`${server.baseUrl}${createdSpace.guestPath}/api/admin/photos`, {
      headers: { Cookie: adminCookies.header() }
    });
    assert.equal(adminPhotosResponse.status, 200);
    const adminPhotos = await adminPhotosResponse.json();
    assert.equal(adminPhotos.length, 1);

    const archiveResponse = await postJson(
      `${server.baseUrl}${createdSpace.guestPath}/api/admin/delete-selected`,
      { ids: [firstPhoto.id] },
      { cookieJar: adminCookies }
    );
    assert.equal(archiveResponse.status, 200);

    const archivedPhotosResponse = await fetch(`${server.baseUrl}${createdSpace.guestPath}/api/admin/photos?scope=archived`, {
      headers: { Cookie: adminCookies.header() }
    });
    const archivedPhotos = await archivedPhotosResponse.json();
    assert.equal(archivedPhotos.length, 1);

    const restoreResponse = await postJson(
      `${server.baseUrl}${createdSpace.guestPath}/api/admin/restore-selected`,
      { ids: [firstPhoto.id] },
      { cookieJar: adminCookies }
    );
    assert.equal(restoreResponse.status, 200);

    const operatorLoginResponse = await postJson(
      `${server.baseUrl}/api/operator/login`,
      { password: 'operator-secret' },
      { cookieJar: operatorCookies }
    );
    assert.equal(operatorLoginResponse.status, 200);

    const plansResponse = await fetch(`${server.baseUrl}/api/plans`);
    assert.equal(plansResponse.status, 200);
    const plansPayload = await plansResponse.json();
    assert.deepEqual(plansPayload.plans.map(plan => plan.id), ['basic', 'premium']);
    assert.equal(plansPayload.plans[0].storageLimitBytes, 20 * 1024 ** 3);
    assert.equal(plansPayload.plans[1].durationMonths, 12);

    const spacesResponse = await fetch(`${server.baseUrl}/api/operator/spaces`, {
      headers: { Cookie: operatorCookies.header() }
    });
    const spacesPayload = await spacesResponse.json();
    const spaceSummary = spacesPayload.spaces.find(space => space.publicId === createdSpace.guestPath.split('/')[2]);
    assert.ok(spaceSummary);

    const suspendResponse = await postJson(
      `${server.baseUrl}/api/operator/spaces/${spaceSummary.id}/status`,
      { status: 'suspended' },
      { cookieJar: operatorCookies }
    );
    assert.equal(suspendResponse.status, 200);

    const reactivateResponse = await postJson(
      `${server.baseUrl}/api/operator/spaces/${spaceSummary.id}/status`,
      { status: 'active' },
      { cookieJar: operatorCookies }
    );
    assert.equal(reactivateResponse.status, 200);

    const rotateResponse = await postJson(
      `${server.baseUrl}/api/operator/spaces/${spaceSummary.id}/rotate-guest-link`,
      {},
      { cookieJar: operatorCookies }
    );
    assert.equal(rotateResponse.status, 200);
    const rotatedPayload = await rotateResponse.json();
    assert.notEqual(rotatedPayload.guestPath, createdSpace.guestPath);

    const oldGuestConfigResponse = await fetch(`${server.baseUrl}${createdSpace.guestPath}/api/config`);
    assert.equal(oldGuestConfigResponse.status, 404);

    const newGuestConfigResponse = await fetch(`${server.baseUrl}${rotatedPayload.guestPath}/api/config`);
    assert.equal(newGuestConfigResponse.status, 200);

    const resetPasswordResponse = await postJson(
      `${server.baseUrl}/api/operator/spaces/${spaceSummary.id}/reset-admin-password`,
      {},
      { cookieJar: operatorCookies }
    );
    assert.equal(resetPasswordResponse.status, 200);
    const resetPasswordPayload = await resetPasswordResponse.json();
    assert.match(resetPasswordPayload.adminPassword, /^[A-Za-z0-9]+$/);

    const customResetResponse = await postJson(
      `${server.baseUrl}/api/operator/spaces/${spaceSummary.id}/reset-admin-password`,
      { adminPassword: 'NeuGesetzt123' },
      { cookieJar: operatorCookies }
    );
    assert.equal(customResetResponse.status, 200);
    const customResetPayload = await customResetResponse.json();
    assert.equal(customResetPayload.adminPassword, 'NeuGesetzt123');

    const expiredAdminSessionResponse = await fetch(`${server.baseUrl}${rotatedPayload.guestPath}/api/admin/photos`, {
      headers: { Cookie: adminCookies.header() }
    });
    assert.equal(expiredAdminSessionResponse.status, 401);

    const operatorPreviewResponse = await fetch(`${server.baseUrl}/api/operator/spaces/${spaceSummary.id}/open/`, {
      headers: { Cookie: operatorCookies.header() }
    });
    assert.equal(operatorPreviewResponse.status, 200);
    assert.match(operatorPreviewResponse.headers.get('content-type') || '', /text\/html/);

    const operatorPreviewConfigResponse = await fetch(`${server.baseUrl}/api/operator/spaces/${spaceSummary.id}/open/api/config`, {
      headers: { Cookie: operatorCookies.header() }
    });
    assert.equal(operatorPreviewConfigResponse.status, 200);
    const operatorPreviewConfig = await operatorPreviewConfigResponse.json();
    assert.equal(operatorPreviewConfig.space.displayName, createdSpace.displayName);

    const customAdminLoginResponse = await postJson(
      `${server.baseUrl}/api/operator/spaces/${spaceSummary.id}/open/api/admin/login`,
      { password: 'NeuGesetzt123' },
      { cookieJar: operatorCookies }
    );
    assert.equal(customAdminLoginResponse.status, 200);

    const operatorCreateResponse = await postJson(
      `${server.baseUrl}/api/operator/spaces`,
      { displayName: 'Operator Space', ownerEmail: 'ops@example.com', adminPassword: 'Operator123', plan: 'premium' },
      { cookieJar: operatorCookies }
    );
    assert.equal(operatorCreateResponse.status, 201);
    const operatorCreatePayload = await operatorCreateResponse.json();
    assert.equal(operatorCreatePayload.space.plan, 'premium');
    assert.equal(operatorCreatePayload.space.storageLimitBytes, 100 * 1024 ** 3);
    assert.ok(operatorCreatePayload.space.expiresAt);

    const operatorPhotosResponse = await fetch(`${server.baseUrl}/api/operator/spaces/${spaceSummary.id}/photos`, {
      headers: { Cookie: operatorCookies.header() }
    });
    assert.equal(operatorPhotosResponse.status, 200);
    const operatorPhotosPayload = await operatorPhotosResponse.json();
    assert.equal(operatorPhotosPayload.photos.length, 1);
  } finally {
    await server.stop();
  }
});