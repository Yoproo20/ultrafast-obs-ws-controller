import OBSWebSocket from "obs-websocket-js";

async function runBenchmark(ip: string, port: string, pass: string, iterations: number = 100) {
    const obs = new OBSWebSocket();
    const obsUrl = `ws://${ip}:${port}`;

    console.log(`Connecting to OBS at ${obsUrl}...`);
    try {
        await obs.connect(obsUrl, pass);
        console.log("Connected successfully.\n");

        console.log(`--- Running ${iterations} Rapid-Fire Network Latency Tests ---`);
        console.log(`(Using 'GetRecordStatus' to test command turnaround time safely)\n`);

        let totalTime = 0;
        let minTime = Infinity;
        let maxTime = 0;

        for (let i = 0; i < iterations; i++) {
            const start = Bun.nanoseconds();

            // We use GetRecordStatus rather than Start/Stop record to avoid actually
            // generating 100 tiny useless video files on the user's hard drive,
            // while still measuring the exact same WebSocket command latency.
            await obs.call("GetRecordStatus");

            const end = Bun.nanoseconds();
            const elapsedMs = (end - start) / 1_000_000;

            totalTime += elapsedMs;
            if (elapsedMs < minTime) minTime = elapsedMs;
            if (elapsedMs > maxTime) maxTime = elapsedMs;
        }

        console.log(`--- Benchmark Results (${iterations} iterations) ---`);
        console.log(`Average Latency : ${(totalTime / iterations).toFixed(3)} ms`);
        console.log(`Min Latency     : ${minTime.toFixed(3)} ms`);
        console.log(`Max Latency     : ${maxTime.toFixed(3)} ms`);
        console.log(`Total Time      : ${totalTime.toFixed(3)} ms\n`);

        await obs.disconnect();
    } catch (err: any) {
        console.error("Benchmark error:", err.message);
    }
}

const args = process.argv.slice(2);
const ip = args[0] || process.env.OBS_IP || "127.0.0.1";
const port = args[1] || process.env.OBS_PORT || "4455";
const pass = args[2] || process.env.OBS_PASS || "";

runBenchmark(ip, port, pass);
