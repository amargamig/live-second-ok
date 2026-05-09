const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const SHARED_SECRET_KEY = process.env.SHARED_SECRET_KEY || "YOUR_PASSWORD";
const activeStreams = new Map();

// Authentication Middleware
const authMiddleware = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === SHARED_SECRET_KEY) {
        return next();
    }
    console.log("Auth Failed: Invalid API Key");
    res.status(403).json({ error: "Unauthorized" });
};

app.post('/start-stream', authMiddleware, (req, res) => {
    try {
        const { video_url, rtmp_urls, loop, stream_id, title } = req.body;

        // डेटा चेक करें
        if (!video_url || !rtmp_urls) {
            return res.status(400).json({ error: "Missing video_url or rtmp_urls" });
        }

        // पक्का करें कि rtmp_urls एक Array है
        const urls = Array.isArray(rtmp_urls) ? rtmp_urls : [rtmp_urls];

        let command = ffmpeg(video_url)
            .inputOptions([
                '-re',
                loop === "true" || loop === true ? '-stream_loop -1' : '-stream_loop 0',
                '-reconnect 1',
                '-reconnect_at_eof 1',
                '-reconnect_streamed 1',
                '-reconnect_delay_max 5'
            ])
            .outputOptions([
                '-c copy',
                '-f flv',
                '-flvflags no_duration_filesize'
            ]);

        // हर URL के लिए आउटपुट जोड़ें
        urls.forEach(url => {
            if (url && url.trim() !== "") {
                command.output(url);
            }
        });

        command
            .on('start', (cmd) => {
                console.log("Stream Started: " + title);
                activeStreams.set(stream_id, {
                    startTime: Date.now(),
                    title: title,
                    video: video_url,
                    process: command
                });
            })
            .on('error', (err) => {
                console.log("FFmpeg Error for " + title + ": " + err.message);
                activeStreams.delete(stream_id);
            })
            .on('end', () => {
                console.log("Stream Ended: " + title);
                activeStreams.delete(stream_id);
            });

        command.run();
        res.json({ success: true, message: "Stream processing initiated", stream_id });

    } catch (globalError) {
        console.log("Global Server Error: ", globalError);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get('/status', (req, res) => {
    const status = [];
    activeStreams.forEach((value, key) => {
        status.push({
            id: key,
            title: value.title,
            runtime: Math.floor((Date.now() - value.startTime) / 1000),
            video: value.video
        });
    });
    res.json(status);
});

app.post('/stop-stream', authMiddleware, (req, res) => {
    const { stream_id } = req.body;
    if (activeStreams.has(stream_id)) {
        activeStreams.get(stream_id).process.kill('SIGKILL');
        activeStreams.delete(stream_id);
        res.json({ success: true, message: "Stream stopped" });
    } else {
        res.status(404).json({ error: "Stream not found" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
