import { serve, file } from "bun";
import OBSWebSocket from "obs-websocket-js";
import { join } from "path";
import { existsSync } from "fs";
import { networkInterfaces } from "os";

const PORT = process.env.PORT || 3000;

function getLocalIp() {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        const interfaces = nets[name];
        if (!interfaces) continue;
        for (const net of interfaces) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return "localhost";
}

// Keep track of client state
type ClientData = {
    obs: OBSWebSocket;
    connected: boolean;
    recording: boolean;
    statsInterval?: ReturnType<typeof setInterval>;
};

serve({
    port: PORT,
    fetch(req, server) {
        const url = new URL(req.url);

        // Upgrade WebSocket requests
        if (url.pathname === "/ws") {
            const upgraded = server.upgrade(req, {
                data: {
                    obs: new OBSWebSocket(),
                    connected: false,
                    recording: false,
                }
            });
            if (!upgraded) {
                return new Response("Upgrade failed", { status: 400 });
            }
            return;
        }

        if (url.pathname === "/api/ip") {
            return new Response(JSON.stringify({ ip: getLocalIp() }), {
                headers: { "Content-Type": "application/json" }
            });
        }

        // Serve Static Files
        let reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
        let filePath = join(import.meta.dir, "public", reqPath);
        
        if (existsSync(filePath)) {
            const f = file(filePath);
            return new Response(f);
        }
        
        return new Response("Not Found", { status: 404 });
    },
    websocket: {
        async message(ws, message) {
            const data = ws.data as ClientData;
            let payload: any;
            try {
                payload = JSON.parse(message as string);
            } catch {
                return;
            }

            if (payload.action === "connect") {
                const { ip, port, pass } = payload;
                const obsUrl = `ws://${ip}:${port}`;

                try {
                    await data.obs.connect(obsUrl, pass);
                    data.connected = true;

                    // Get initial record status
                    const status = await data.obs.call("GetRecordStatus");
                    data.recording = status.outputActive;

                    ws.send(JSON.stringify({
                        type: "status",
                        connected: true,
                        recording: data.recording
                    }));

                    // Listen for OBS events
                    data.obs.on("RecordStateChanged", (e) => {
                        data.recording = e.outputActive;
                        ws.send(JSON.stringify({
                            type: "status",
                            connected: true,
                            recording: data.recording
                        }));
                    });

                    // Start polling stats
                    data.statsInterval = setInterval(async () => {
                        if (!data.connected) return;
                        try {
                            const stats = await data.obs.call("GetStats");
                            ws.send(JSON.stringify({
                                type: "stats",
                                diskSpace: stats.availableDiskSpace / 1024, // Assuming MB returned, convert to GB
                                droppedFrames: stats.outputSkippedFrames + stats.renderSkippedFrames
                            }));
                        } catch (err) {
                            // Ignore polling errors
                        }
                    }, 1000);

                } catch (err: any) {
                    console.error("OBS Connection Error:", err.message);
                    ws.send(JSON.stringify({ type: "error", message: err.message }));
                }

            } else if (payload.action === "toggle") {
                // THE "INSTANT" COMMAND
                // We fire to OBS instantly based on our known state without waiting for phone ack
                if (!data.connected) return;

                const start = Bun.nanoseconds();
                try {
                    let promise;
                    if (data.recording) {
                        promise = data.obs.call("StopRecord");
                    } else {
                        promise = data.obs.call("StartRecord");
                    }
                    // Optimistic state flip locally until OBS event confirms
                    data.recording = !data.recording;

                    promise.then(() => {
                        const end = Bun.nanoseconds();
                        const timeMs = (end - start) / 1_000_000;
                        console.log(`Bun processing time (forwardToOBS): ${timeMs.toFixed(3)}ms`);
                        ws.send(JSON.stringify({ type: "benchmark_result", timeMs }));
                    }).catch((err) => console.error("OBS toggle command failed:", err));

                } catch (err) {
                    console.error("Failed to toggle:", err);
                }
            }
        },
        close(ws) {
            const data = ws.data as ClientData;
            if (data) {
                if (data.statsInterval) clearInterval(data.statsInterval);
                if (data.connected) {
                    data.obs.disconnect().catch(() => {});
                }
            }
        }
    }
});

console.log(`Server listening at http://localhost:${PORT}`);
