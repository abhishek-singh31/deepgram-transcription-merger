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
            const rel = relativeStartSec(w);
            if (rel == null) continue;
            const epoch = info.streamAnchorEpoch + rel;
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

      if (info.lastTs !== undefined && ts > info.lastTs + 20) {
        /* Fill gap with silence */
        const diff = ts - (info.lastTs + 20); // ms
        const lostByte = Buffer.alloc(8 * diff, 0);
        this.deepHandlers[track].send(lostByte);
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
    const _this = this;
    if (this.isMediaStream) {
      clearInterval(_this.logsinterval);
      //sending end signal to deepgram
      if (_this.deepHandlers["outbound"]) {
        _this.deepHandlers["outbound"].send(new Uint8Array(0));
      }

      if (_this.deepHandlers["inbound"]) {
        _this.deepHandlers["inbound"].send(new Uint8Array(0));
      }

      _this.endTime = Math.round(Date.now() / 1000);

      setTimeout(function () {
        var returnarray = {};
        returnarray["transcription"] = _this.finalarrray;
        returnarray["completetranscription"] = _this.completetranscription;
        returnarray["datetime"] = Math.round(_this.endTime);
        returnarray["startTime"] = Math.round(_this.startTime);
        returnarray["endTime"] = Math.round(_this.endTime);
        returnarray["participant_label"] = _this.participant_label;
        returnarray["metadata"] = _this.metaData;
        returnarray["callduration"] = Math.round(
          _this.endTime - _this.startTime
        );

        console.log("Media WS: closed");
        for (let track of Object.keys(_this.deepHandlers)) {
          _this.deepHandlers[track].close();
        }

        try {
          // store in file

          // Create transcriptions directory if it doesn't exist
          const transcriptionsDir = path.join(__dirname, "transcriptions");
          if (!fs.existsSync(transcriptionsDir)) {
            fs.mkdirSync(transcriptionsDir, { recursive: true });
          }

          // Write file to transcriptions folder
          let transcriptionFileName = `transcription-${returnarray["callsid"]}.json`;
          if (_this.metaData.customParameters.call_flow_type === "normal") {
            transcriptionFileName = `transcription-normal.json`;
          } else {
            transcriptionFileName = `transcription-${_this.metaData.customParameters.track1_label}.json`;
          }

          const filePath = path.join(transcriptionsDir, transcriptionFileName);
          fs.writeFile(filePath, JSON.stringify(returnarray), (err) => {
            if (err) {
              console.error("Error writing transcription file:", err);
            } else {
              console.log("Transcription saved successfully");
            }
          });
        } catch (error) {
          console.log("Error in transcription.json:", error);
        }
      }, 3000);
    }
  }

  closeConnection(reason = "") {
    if (this.isMediaStream) {
      // do not accidently close the media stream connection
      return;
    }

    this.connection.send(
      JSON.stringify({
        message: reason,
      })
    );
    this.closeError = reason;
    this.isClosedIntentionally = true;
    this.connection.close(4001, reason);
  }
}

server.listen(HTTP_SERVER_PORT, "127.0.0.1", function () {
  console.log(new Date(), ":  App running on Port ", server.address().port);
});
