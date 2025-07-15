const { writeFile, mkdirSync, existsSync } = require("fs");
const { join } = require("path");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const DeepgramService = require("./deepgram-service");

const app = express();

const server = http.createServer(app);
const HTTP_SERVER_PORT = 3000;

app.get("/stream/health", (req, res) => {
  res.send('{"status":"Success"}'); // This is the response that will be sent when the endpoint is accessed
});

const wss = new WebSocket.Server({ server });
wss.on("connection", function (connection) {
  console.log("Media WS: Connection accepted");
  new MediaStreamHandler(connection);

  connection.on("close", function () {
    console.log("Connection closed");
  });
});

class MediaStreamHandler {
  constructor(connection) {
    this.metaData = null;
    this.deepHandlers = {};
    this.isopen = 0;
    this.finalarrray = [];
    this.completetranscription = "";
    this.count_id = 0;
    this.isfirst = true;
    this.track0 = "";
    this.track1 = "";
    this.complete_tran = "";
    this.isgoogleerror = 0;
    this.startTime = 0;
    this.endTime = 0;
    this.latestInboundPacket = null;
    this.latestOutboundPacket = null;
    this.inboundstart = 0;
    this.outboundstart = 0;
    this.companyid = null;
    this.participants = {};
    this.call_flow_type = null;
    this.stream_start_time_in_epoch_seconds = null;

    //test
    this.deepresponse = [];

    //logs
    this.logsmetadata = {};
    this.lastpackettime = null;
    this.logsinterval = null;

    // this represents a websocket connection
    this.connection = connection;
    this.connectionID = null;

    this.source = null;
    this.payload = null;
    this.authError = null;
    this.closeError = null;

    // mediastreams
    this.isMediaStream = false;
    this.thash = null;
    this.uhash = null;
    this.sendcount = 0;
    this.isad = null;

    this.featureFlagEnabled = false; // Default value
    this.featureFlagInitialized = false;
    connection.on("message", this.processMessage.bind(this));
    connection.on("close", this.close.bind(this));
  }

  /**
   * Utility: convert Deepgram or Google‑style word object → relative seconds
   */
  relativeStartSec(word) {
    if (word.start !== undefined) return Number(word.start); // Deepgram
    if (word.startTime) {
      return (
        Number(word.startTime.seconds || 0) +
        Number(word.startTime.nanos || 0) / 1e9
      ); // Google
    }
    return null; // malformed
  }

  processMessage(message) {
    try {
      /******************** 0.  Pre‑flight checks & parse ********************/
      if (typeof message === "string" && message.trim() === "") {
        if (!this.isMediaStream) this.closeConnection("Empty auth message");
        return;
      }
      const data = JSON.parse(message);
      if (!data?.event) return;

      /******************** 1.  Handle “start / stop” ********************/
      if (data.event === "start") {
        console.log("WS stream start");
        this.isMediaStream = true;
        this.metaData = data.start;
        this.call_flow_type = this.metaData.customParameters.call_flow_type;
        this.recordingStartEpoch = Number(
          this.metaData.customParameters
            .recording_start_time_in_epoch_seconds || 0
        );
        this.trackInfo = { inbound: {}, outbound: {} }; // per‑track timing
        this.participants = {
          0: {
            label: this.metaData.customParameters.track0_label || "unknown",
          },
          1: {
            label: this.metaData.customParameters.track1_label || "unknown1",
          },
        };
        this.startTime = Math.floor(Date.now() / 1000);
        this.completetranscription = "";
        this.finalarrray = [];
        this.track0 = this.track1 = "";

        /* watchdog – no packets for >5 s ⇒ error */
        this.lastpackettime = 0;
        clearInterval(this.logsinterval);
        this.logsinterval = setInterval(() => {
          if (this.lastpackettime === 0) return;
          if (Date.now() / 1000 - this.lastpackettime > 5) {
            console.log("Deepgram stream stalled >5 s");
            clearInterval(this.logsinterval);
          }
        }, 5000);
        return;
      }
      if (data.event === "stop") {
        console.log("WS stream stop");
        return;
      }

      /******************** 2.  Ignore non‑media ********************/
      if (data.event !== "media") return;

      const track = data.media.track; // inbound | outbound
      if (track !== "inbound" && this.call_flow_type === "conference") return;

      /******************** 3.  Initialise per‑track info ********************/
      if (!this.deepHandlers[track]) {
        this.deepHandlers[track] = new DeepgramService();
        const dg = this.deepHandlers[track];

        /* Deepgram → transcription handler */
        dg.on("transcription", (dgMsg /* , refresh */) => {
          const info = this.trackInfo[track]; // timing for this track

          /* 3‑A. compute streamAnchorEpoch once we know first‑packet timing */
          if (
            !info.streamAnchorEpoch &&
            info.firstWall &&
            info.firstTs !== undefined
          ) {
            info.streamAnchorEpoch = info.firstWall - info.firstTs / 1000;
          }
          if (!info.streamAnchorEpoch) return; // still waiting…

          /* -------- add offset_in_recording to each word -------- */
          const res = dgMsg?.results?.[0];
          const alt = res?.alternatives?.[0] || {};
          const wordsArr = alt.words || [];

          for (const w of wordsArr) {
            const rel = this.relativeStartSec(w);
            if (rel == null) continue;
            const epoch = info.streamAnchorEpoch + rel;
            console.log(`epoch: ${epoch} recordingStartEpoch: ${this.recordingStartEpoch}`);
            w.offset_in_recording = Number(
              (epoch - this.recordingStartEpoch).toFixed(3)
            );
          }

          /* -------- transcript bookkeeping -------- */
          const trackIdx = track === "inbound" ? 1 : 0; // 0=customer,1=agent
          res.track = trackIdx;
          res.participant_label = this.participants[trackIdx].label;

          if (res.isFinal) {
            const text = alt.transcript;
            if (trackIdx === 0) this.track0 += text + " ";
            else this.track1 += text + " ";
            this.completetranscription += text + " ";
            this.finalarrray.push(dgMsg);
            console.log(`[${res.participant_label}] ${text}`);
          }
        });

        dg.on("error", (e) => console.log("Deepgram error", e));
        dg.on("close", (e) => console.log("Deepgram close", e));
        dg.on("first-event", (e) => console.log("Deepgram first event", e));
      }

      /******************** 4.  Packet‑loss padding & first‑packet timing ********************/
      const info = (this.trackInfo[track] ||= {});
      const ts = data.media.timestamp; // Twilio ms

      if (info.lastTs !== undefined) {
        const gap = ts - info.lastTs;
      
        if (gap > 20) {
          const missingMs = gap - 20;
          const byteCount = 8 * missingMs;
      
          if (byteCount > 0 && byteCount <= 10_000_000) {
            // limit to avoid flooding Deepgram with silence
            const lostByte = Buffer.alloc(byteCount, 0);
            this.deepHandlers[track].send(lostByte);
          } else {
            console.warn(`Skipping silence padding, invalid byteCount: ${byteCount}`);
          }
        }
      }
      info.lastTs = ts;

      if (!info.firstWall) {
        info.firstWall = Date.now() / 1000; // seconds epoch
        info.firstTs = ts; // ms
      }

      /******************** 5.  Forward audio to Deepgram ********************/
      const pcm = Buffer.from(data.media.payload, "base64");
      this.lastpackettime = Math.floor(Date.now() / 1000);
      this.deepHandlers[track].send(pcm);
    } catch (err) {
      console.error("processMessage error:", err);
    }
  }

close() {
  if (!this.isMediaStream) return;

  clearInterval(this.logsinterval);

  // Send zero-byte to close Deepgram streams
  ["inbound", "outbound"].forEach((track) => {
    this.deepHandlers[track]?.send(new Uint8Array(0));
  });

  this.endTime = Math.floor(Date.now() / 1000);

  setTimeout(() => {
    const startTime = this.startTime || this.endTime;
    const callDuration = this.endTime - startTime;

    const result = {
      transcription: this.finalarrray,
      completetranscription: this.completetranscription,
      datetime: this.endTime,
      startTime,
      endTime: this.endTime,
      callduration: callDuration,
      participant_label: this.participant_label || "",
      metadata: this.metaData || {},
    };

    console.log("Media WS: closed");

    // Close Deepgram handlers
    for (const handler of Object.values(this.deepHandlers)) {
      handler.close?.();
    }

    try {
      const dir = join(__dirname, "transcriptions");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      let filename = "transcription.json";

      const params = this.metaData?.customParameters;
      if (params?.call_flow_type === "normal") {
        filename = "transcription-normal.json";
      } else if (params?.track1_label) {
        filename = `transcription-${params.track1_label}.json`;
      }

      const filePath = join(dir, filename);

      console.log("Writing transcription to file", filePath);

      writeFile(filePath, JSON.stringify(result, null, 2), (err) => {
        if (err) {
          console.error("Error writing transcription file:", err);
        } else {
          console.log(`Transcription saved to ${filePath}`);
        }
      });
    } catch (err) {
      console.error("Error saving transcription:", err);
    }
  }, 3000);
}

closeConnection(reason = "") {
  if (this.isMediaStream) return;

  if (this.connection?.readyState === 1) {
    this.connection.send(JSON.stringify({ message: reason }));
  }

  this.closeError = reason;
  this.isClosedIntentionally = true;

  this.connection?.close?.(4001, reason);
}

}

server.listen(HTTP_SERVER_PORT, "127.0.0.1", function () {
  console.log(new Date(), ":  App running on Port ", server.address().port);
});
