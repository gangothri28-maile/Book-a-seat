const http = require('http');

async function runLoadTest(concurrency = 50, totalRequests = 250) {
  console.log('===============================================================');
  console.log(`🚀 RUNNING SEATSURGE LOAD TEST: ${totalRequests} requests, Concurrency: ${concurrency}`);
  console.log('===============================================================');

  const url = 'http://localhost:4000/api/seats?eventId=evt_symphony_2026';
  const latencies = [];
  let successful = 0;
  let failed = 0;

  const startTime = Date.now();
  let completed = 0;

  function doRequest() {
    return new Promise((resolve) => {
      const t0 = Date.now();
      http.get(url, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          const lat = Date.now() - t0;
          latencies.push(lat);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            successful++;
          } else {
            failed++;
          }
          completed++;
          resolve();
        });
      }).on('error', (err) => {
        failed++;
        completed++;
        resolve();
      });
    });
  }

  // Run in concurrent worker pools
  const queue = Array.from({ length: totalRequests }, (_, i) => i);
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      queue.pop();
      await doRequest();
    }
  });

  await Promise.all(workers);

  const totalTimeSec = (Date.now() - startTime) / 1000;
  latencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const avg = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);
  const throughput = Math.round(successful / totalTimeSec);

  console.log(`\n📊 LOAD TEST RESULTS:`);
  console.log(`   - Total Requests Sent : ${totalRequests}`);
  console.log(`   - Successful Responses: ${successful} (${((successful/totalRequests)*100).toFixed(1)}%)`);
  console.log(`   - Failed Responses    : ${failed}`);
  console.log(`   - Total Elapsed Time  : ${totalTimeSec.toFixed(2)}s`);
  console.log(`   - Measured Throughput : ${throughput} req/sec`);
  console.log(`   - Latency (Avg)       : ${avg.toFixed(1)} ms`);
  console.log(`   - Latency (p50)       : ${p50} ms`);
  console.log(`   - Latency (p95)       : ${p95} ms`);
  console.log(`   - Latency (p99)       : ${p99} ms`);
  console.log('===============================================================\n');
}

if (require.main === module) {
  runLoadTest(30, 200)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Load test error:', err);
      process.exit(1);
    });
}

module.exports = runLoadTest;
