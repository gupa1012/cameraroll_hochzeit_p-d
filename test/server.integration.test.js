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
  const form = new FormData();
  form.append('photo', new Blob([tinyPngBuffer], { type: 'image/png' }), 'tiny.png');
  form.append('device_id', deviceId);
  form.append('comment', comment || 'Ein Testfoto');
  form.append('uploader_info', JSON.stringify({ browser: 'node-test', os: 'test-os', device: 'test-device' }));

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

async function createSelfServeSpace(baseUrl) {
  const response = await postJson(`${baseUrl}/api/spaces`, {
    displayName: 'Anna und Ben',
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

    const expiredAdminSessionResponse = await fetch(`${server.baseUrl}${rotatedPayload.guestPath}/api/admin/photos`, {
      headers: { Cookie: adminCookies.header() }
    });
    assert.equal(expiredAdminSessionResponse.status, 401);

    const operatorCreateResponse = await postJson(
      `${server.baseUrl}/api/operator/spaces`,
      { displayName: 'Operator Space', ownerEmail: 'ops@example.com', adminPassword: 'Operator123' },
      { cookieJar: operatorCookies }
    );
    assert.equal(operatorCreateResponse.status, 201);

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