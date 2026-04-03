'use strict';

const { randomFillSync, randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const sharp = require('sharp');

function parseArgs(argv) {
  const options = {
    baseUrl: 'http://localhost:3000',
    uploads: 40,
    concurrency: 8,
    width: 2200,
    height: 1500,
    quality: 92,
    rounds: 1,
    pauseMs: 0,
    jsonOut: '',
    displayName: `Loadtest ${new Date().toISOString().slice(0, 19)}`,
    ownerEmail: 'loadtest@example.com',
    adminPassword: 'Loadtest1234',
    comment: 'Loadtest Upload'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;

    const [flag, inlineValue] = current.split('=', 2);
    const nextValue = inlineValue ?? argv[index + 1];
    const consumeNext = inlineValue === undefined;

    switch (flag) {
      case '--baseUrl':
        options.baseUrl = nextValue;
        break;
      case '--uploads':
        options.uploads = Number.parseInt(nextValue, 10);
        break;
      case '--concurrency':
        options.concurrency = Number.parseInt(nextValue, 10);
        break;
      case '--width':
        options.width = Number.parseInt(nextValue, 10);
        break;
      case '--height':
        options.height = Number.parseInt(nextValue, 10);
        break;
      case '--quality':
        options.quality = Number.parseInt(nextValue, 10);
        break;
      case '--rounds':
        options.rounds = Number.parseInt(nextValue, 10);
        break;
      case '--pauseMs':
        options.pauseMs = Number.parseInt(nextValue, 10);
        break;
      case '--jsonOut':
        options.jsonOut = nextValue;
        break;
      case '--displayName':
        options.displayName = nextValue;
        break;
      case '--ownerEmail':
        options.ownerEmail = nextValue;
        break;
      case '--adminPassword':
        options.adminPassword = nextValue;
        break;
      case '--comment':
        options.comment = nextValue;
        break;
      default:
        break;
    }

    if (consumeNext) index += 1;
  }

  return options;
}

async function createImageBuffer({ width, height, quality }) {
  const raw = Buffer.alloc(width * height * 3);
  randomFillSync(raw);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function createSpace({ baseUrl, displayName, ownerEmail, adminPassword }) {
  const response = await fetch(`${baseUrl}/api/spaces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ displayName, ownerEmail, adminPassword })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Space konnte für den Lasttest nicht erstellt werden.');
  }

  return payload;
}

async function uploadOne({ guestUrl, imageBuffer, comment, sequence }) {
  const form = new FormData();
  const startedAt = performance.now();
  const deviceId = randomUUID();

  form.append('photo', new Blob([imageBuffer], { type: 'image/jpeg' }), `loadtest-${sequence + 1}.jpg`);
  form.append('device_id', deviceId);
  form.append('comment', `${comment} #${sequence + 1}`);
  form.append('uploader_info', JSON.stringify({ browser: 'loadtest', os: 'node', device: `virtual-${sequence + 1}` }));

  const response = await fetch(`${guestUrl}/api/upload`, {
    method: 'POST',
    headers: {
      'X-Device-Id': deviceId
    },
    body: form
  });

  const durationMs = performance.now() - startedAt;
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || `Upload ${sequence + 1} fehlgeschlagen (${response.status}).`);
  }

  return durationMs;
}

function summarizeDurations(durations, uploadCount, totalDurationMs, failures, guestUrl) {
  const sortedDurations = [...durations].sort((left, right) => left - right);
  const successCount = sortedDurations.length;
  const averageMs = successCount ? sortedDurations.reduce((sum, value) => sum + value, 0) / successCount : 0;

  return {
    guestUrl,
    uploadCount,
    durations: sortedDurations,
    successCount,
    failureCount: failures.length,
    totalDurationMs,
    averageMs,
    p50Ms: percentile(sortedDurations, 0.5),
    p95Ms: percentile(sortedDurations, 0.95),
    maxMs: percentile(sortedDurations, 0.999),
    failures
  };
}

function percentile(sortedNumbers, fraction) {
  if (!sortedNumbers.length) return 0;
  const index = Math.min(sortedNumbers.length - 1, Math.floor(sortedNumbers.length * fraction));
  return sortedNumbers[index];
}

async function runPool(items, concurrency, worker) {
  const results = [];
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => runWorker()));
  return results;
}

async function runSingleRound(options, imageBuffer, roundIndex) {
  const displayName = `${options.displayName} Runde ${roundIndex + 1}`;
  const space = await createSpace({
    baseUrl: options.baseUrl,
    displayName,
    ownerEmail: options.ownerEmail,
    adminPassword: options.adminPassword
  });
  console.log(`Lasttest-Space erstellt: ${space.guestUrl}`);

  const sequences = Array.from({ length: options.uploads }, (_, index) => index);
  const durations = [];
  const failures = [];
  const startedAt = performance.now();

  await runPool(sequences, options.concurrency, async sequence => {
    try {
      const duration = await uploadOne({
        guestUrl: space.guestUrl,
        imageBuffer,
        comment: options.comment,
        sequence
      });
      durations.push(duration);
      process.stdout.write(`Runde ${roundIndex + 1} · Upload ${sequence + 1}/${options.uploads} in ${duration.toFixed(0)} ms\n`);
    } catch (error) {
      failures.push({ sequence, message: error.message });
      process.stdout.write(`Runde ${roundIndex + 1} · Upload ${sequence + 1}/${options.uploads} FEHLER: ${error.message}\n`);
    }
  });

  const totalDurationMs = performance.now() - startedAt;
  return summarizeDurations(durations, options.uploads, totalDurationMs, failures, space.guestUrl);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const healthResponse = await fetch(`${options.baseUrl}/api/health`);
  if (!healthResponse.ok) {
    throw new Error(`Healthcheck fehlgeschlagen (${healthResponse.status}).`);
  }

  console.log(`Erzeuge Lasttest-Bild mit ${options.width}x${options.height} Pixeln ...`);
  const imageBuffer = await createImageBuffer(options);
  console.log(`Bildgroesse: ${(imageBuffer.length / (1024 * 1024)).toFixed(2)} MB`);

  const rounds = [];
  for (let roundIndex = 0; roundIndex < Math.max(1, options.rounds); roundIndex += 1) {
    console.log('');
    console.log(`Starte Runde ${roundIndex + 1}/${Math.max(1, options.rounds)} ...`);
    const result = await runSingleRound(options, imageBuffer, roundIndex);
    rounds.push(result);

    if (options.pauseMs > 0 && roundIndex < options.rounds - 1) {
      console.log(`Warte ${options.pauseMs} ms bis zur naechsten Runde ...`);
      await new Promise(resolve => setTimeout(resolve, options.pauseMs));
    }
  }

  const totalUploads = rounds.reduce((sum, round) => sum + round.uploadCount, 0);
  const totalSuccess = rounds.reduce((sum, round) => sum + round.successCount, 0);
  const totalFailures = rounds.reduce((sum, round) => sum + round.failureCount, 0);
  const allDurations = rounds.flatMap(round => round.durations);
  const aggregate = summarizeDurations(
    allDurations,
    totalUploads,
    rounds.reduce((sum, round) => sum + round.totalDurationMs, 0),
    rounds.flatMap(round => round.failures),
    rounds[rounds.length - 1]?.guestUrl || ''
  );

  console.log('');
  console.log('Ergebnis');
  console.log(`Runden: ${rounds.length}`);
  console.log(`Erfolgreich: ${totalSuccess}/${totalUploads}`);
  console.log(`Fehlgeschlagen: ${totalFailures}`);
  console.log(`Gesamtdauer: ${(aggregate.totalDurationMs / 1000).toFixed(1)} s`);
  console.log(`Durchschnitt: ${aggregate.averageMs.toFixed(0)} ms`);
  console.log(`P50: ${aggregate.p50Ms.toFixed(0)} ms`);
  console.log(`P95: ${aggregate.p95Ms.toFixed(0)} ms`);
  console.log(`Max: ${aggregate.maxMs.toFixed(0)} ms`);
  console.log(`Letzter Space: ${aggregate.guestUrl}`);

  if (options.jsonOut) {
    const report = {
      createdAt: new Date().toISOString(),
      options,
      imageSizeBytes: imageBuffer.length,
      aggregate,
      rounds
    };
    await fsp.writeFile(options.jsonOut, JSON.stringify(report, null, 2), 'utf8');
    console.log(`JSON-Report gespeichert: ${options.jsonOut}`);
  }

  if (totalFailures) {
    console.log('');
    for (const failure of aggregate.failures.slice(0, 10)) {
      console.log(`Fehler bei Upload ${failure.sequence + 1}: ${failure.message}`);
    }
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});