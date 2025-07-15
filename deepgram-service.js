/**
 * DeepgramService
 * ---------------
 * Small wrapper around the Deepgram real‑time WS API that:
 *   • Holds a single streaming socket
 *   • Buffers PCM until WS is open
 *   • Emits 'transcription', 'first‑event', 'error', 'close'
 *   • Adds an accurate offset (sec) against Twilio recordingStartEpoch
 */

require("dotenv").config();
const EventEmitter = require("events");
const WebSocket = require("ws");

class DeepgramService extends EventEmitter {
  constructor() {
    super();
    /** WebSocket instance */
    this.stream = null;
    /** When we called DG listen */
    this.streamCreatedAt = null;
    /** First‑message alignment offset (sec) */
    this.offset = 0;

    /* Customisable params */
    this.primarylanguage = "en-US";
    this.alternativelanguage = "en-US";
    this.model = "nova-2-general";
    this.redact = null;

    /* Internal flags / buffers */
    this.isOpen = false;
    this.buffer = [];
    this.writeBuffer = true;
    this.isFirstResponse = true;

    /** <- Will be injected by caller */
    this.recordingStartEpoch = null; // seconds epoch
  }

  /* ---------- Public API ---------- */

  /**
   * Pass the Twilio RecordingStarted epoch (in **seconds**).
   * Call this immediately after you know it.
   */
  setRecordingStartEpoch(epochSeconds) {
    this.recordingStartEpoch = Number(epochSeconds);
  }

  /**
   * Forward raw 8 kHz Mulaw PCM to DG
   */
  send(payload) {
    const ws = this._getStream();
    if (!ws) return;

    if (this.isOpen) {
      if (this.writeBuffer) {
        // Flush any buffered audio once socket is open
        this.writeBuffer = false;
        this.buffer.forEach((buf) => ws.send(buf));
        this.buffer = [];
      }
      ws.send(payload);
    } else {
      this.buffer.push(payload); // queue until open
    }
  }

  /**
   * Gracefully end the DG socket
   */
  close() {
    this.stream?.close();
  }

  /* ---------- Internal ---------- */

  _needNewStream() {
    return !this.stream || this.stream.readyState >= WebSocket.CLOSING;
  }

  _getStream() {
    if (!this._needNewStream()) return this.stream;

    // Close old socket if still around
    this.stream?.close();

    /* Build query string */
    const q = new URLSearchParams({
      encoding: "mulaw",
      sample_rate: 8000,
      language: this.primarylanguage,
      model: this.model || "nova-2-general",
      smart_format: true,
      filler_words: true,
      no_delay: true,
      interim_results: true,
      vad_turnoff: 60,
    });
    if (this.redact) {
      this.redact
        .split(",")
        .forEach((v) => q.append("redact", v.trim()));
    }

    const url = `wss://api.deepgram.com/v1/listen?${q.toString()}`;
    const creds = process.env.DEEPGRAM_API_KEY;

    console.log("[DG] opening →", url);
    this.streamCreatedAt = Date.now() / 1000;

    try {
      this.stream = new WebSocket(url, {
        headers: { Authorization: `Token ${creds}` },
      });
    } catch (err) {
      console.error("[DG] WS create error:", err);
      return null;
    }

    /* -------- WS event wiring -------- */
    this.stream.on("open", () => {
      this.isOpen = true;
      console.log("[DG] socket open");
    });

    this.stream.on("error", (e) => this.emit("error", e));
    this.stream.on("close", (e) => {
      console.log("[DG] socket closed");
      this.emit("close", e);
    });

    // First message & transcription handler
    this.stream.on("message", (raw) => {
      const data = JSON.parse(raw);

      /* ---- First response: calculate offset ---- */
      if (this.isFirstResponse) {
        const nowEpoch = Date.now() / 1000;
        if (this.recordingStartEpoch) {
          // Align to Twilio recording start
          this.offset = nowEpoch - this.recordingStartEpoch;
          console.log(
            `[DG] first packet → offset=${this.offset.toFixed(3)} s`
          );
        } else {
          // Fallback to streamCreatedAt
          this.offset = nowEpoch - this.streamCreatedAt;
          console.warn(
            "[DG] recordingStartEpoch not set; using streamCreatedAt fallback"
          );
        }

        if (data.metadata) this.emit("first-event", data.metadata);
        this.isFirstResponse = false;
      }

      /* ---- Forward transcript ---- */
      if (data.channel?.alternatives?.[0]?.transcript) {
        // Add a simple serial number (original code)
        data.sno = Date.now();

        // Convert into your Google‑style structure & inject offset
        this.emit("transcription", convert(data, this.offset));
      }
    });

    return this.stream;
  }
}

/* ---------- Helper: convert Deepgram JSON to internal format ---------- */
function convert(dg, offsetSec) {
  const alt = dg.channel.alternatives[0];
  const words = alt.words.map((w) => {
    const sec = Math.floor(w.start + offsetSec);
    const nano = ((w.start + offsetSec) % 1).toFixed(3).substring(2) + "000000";
    const endSec = Math.floor(w.end + offsetSec);
    const endNano =
      ((w.end + offsetSec) % 1).toFixed(3).substring(2) + "000000";
    return {
      word: w.punctuated_word,
      startTime: {
        seconds: sec,
        nanos: nano,
        finalseconds: sec,
        finalnanos: nano,
      },
      endTime: {
        seconds: endSec,
        nanos: endNano,
        finalseconds: endSec,
        finalnanos: endNano,
      },
    };
  });

  return {
    results: [
      {
        alternatives: [
          {
            words,
            transcript: alt.transcript,
            confidence: alt.confidence,
          },
        ],
        isFinal: dg.is_final,
        speechFinal: dg.speech_final,
        resultEndTime: dg.duration + offsetSec,
        sno: dg.sno,
        requestid: dg.metadata.request_id,
      },
    ],
  };
}

module.exports = DeepgramService;