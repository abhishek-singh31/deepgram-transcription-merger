const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const DeepgramService = require("./deepgram-service");

const app = express();

const server = http.createServer(app);
const HTTP_SERVER_PORT = 3000;

app.get('/stream/health', (req, res) => {
    res.send('{"status":"Success"}'); // This is the response that will be sent when the endpoint is accessed
});

const wss = new WebSocket.Server({ server });
wss.on("connection", function (connection) {
    console.log("Media WS: Connection accepted");
    new MediaStreamHandler(connection);

    connection.on("message", function (message) {
        // console.log("Message received:", message);
    });

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
      // this.sentimentbundle = "";
      // this.bundlecount = 0;
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

    processMessage(message) {
        // console.log("Message received:", message);
        const _this = this;
        try {
            if (typeof message == "string" && message.trim() == "") {
                if (!this.isMediaStream) {
                    _this.closeConnection(
                        "Authentication required: Message String is empty"
                    );
                }
                return;
            }

            const data = JSON.parse(message);
            if (!data.hasOwnProperty("event")) {
                return;
            }

            if (data.event == "start") {
                console.log("Websocket stream start");
                this.metaData = data.start;
                this.call_flow_type = this.metaData.customParameters.call_flow_type;
                this.startTime = Math.round(Date.now() / 1000);
                this.isMediaStream = true;
                this.completetranscription = "";
                this.finalarrray = [];
                this.complete_tran = "";
                this.participants = {
                    0 : {
                        label : this.metaData?.customParameters?.track0_label || "unknown",
                    },
                    1 : {
                        label : this.metaData?.customParameters?.track1_label || "unknown1"
                    } 
                }


                 //check stream in last 5 seconds
                this.logsinterval = setInterval(() => {
                    if (
                        _this.lastpackettime == 0 ||
                        Math.round(Date.now() / 1000) - _this.lastpackettime > 5
                    ) {
                        console.log("deepgram stream error");
                        clearInterval(_this.logsinterval);
                    }
                }, 5000);
                return;
            }  else if (data.event == "stop") {
                console.log("Websocket stream stop");
            }

            if (data.event !== "media") {
                console.log("Websocket stream not media");
                return;
            }

            const track = data.media.track;

            if(track != "inbound" && this.call_flow_type == "conference") {
                return;
            }

            if (this.deepHandlers[track] === undefined) {
                const newWSS = new DeepgramService();

                newWSS.on("transcription", (transcription, refresh) => {
                    // console.log("transcription", transcription);
                    var finaltrack = 0;
                    if (track == "inbound") {
                        finaltrack = 1; //agent
                    }

                    var sno = 0;
                    transcription.results[0].track = finaltrack;
                    transcription.results[0].participant_label = this.participants[finaltrack].label;


                    var text = transcription.results[0].alternatives[0]["transcript"];
                    if (transcription.results[0].isFinal == true) {
                        if (finaltrack == 0) {
                            this.track0 +=
                              transcription.results[0].alternatives[0]["transcript"] + " ";
                        } else {
                            this.track1 +=
                              transcription.results[0].alternatives[0]["transcript"] + " ";
                        }
                        
                        this.completetranscription +=
                            transcription.results[0].alternatives[0]["transcript"] + " ";
                          this.finalarrray.push(transcription);
                          
                        console.log(`${finaltrack} - ${text}`);
                    }
                });

                newWSS.on("error", (e) => {
                    console.log("deepgram stream error", e);
                });

                newWSS.on("first-event", (event) => {
                    console.log("deepgram stream first event", event);
                }); 

                newWSS.on("close", (event) => {
                    console.log("deepgram stream close", event);
                });

                this.deepHandlers[track] = newWSS;
            }

            if (track == "inbound") {
                if (this.inboundstart == 1) {
                  if (parseInt(this.latestInboundPacket) + 20 < data.media.timestamp) {
                    var diff =
                      data.media.timestamp - (parseInt(this.latestInboundPacket) + 20);
                    var bytestofill = 8 * diff;
                    var lostbytes = Buffer.alloc(bytestofill, 0);
                    this.deepHandlers[track].send(lostbytes);
                  }
                }
                if (this.inboundstart == 0) {
                  this.inboundstart = 1;
                }
                this.latestInboundPacket = data.media.timestamp;
            } else if (track == "outbound") {
                if (this.outboundstart == 1) {
                  if (parseInt(this.latestOutboundPacket) + 20 < data.media.timestamp) {
                    var diff =
                      data.media.timestamp - (parseInt(this.latestOutboundPacket) + 20);
                    var bytestofill = 8 * diff;
                    var lostbytes = Buffer.alloc(bytestofill, 0);
                    this.deepHandlers[track].send(lostbytes);
                  }
                }
                if (this.outboundstart == 0) {
                  this.outboundstart = 1;
                }
                this.latestOutboundPacket = data.media.timestamp;
            }

            var arrByte = Buffer.from(data.media.payload, "base64"); //converting base 64 to binary
            // if(this.sendcount<10){
            this.lastpackettime = Math.round(Date.now() / 1000);
            this.deepHandlers[track].send(arrByte);
        } catch (error) {
            console.error("Error in processMessage:", error);
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
                //finding companyid
                
                var enddatetime = Math.round(Date.now() / 1000);
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

                // generate random string for call sid
                returnarray["callsid"] = Math.random().toString(36).substring(2, 15);
                
                console.log("Media WS: closed");
                for (let track of Object.keys(_this.deepHandlers)) {
                  _this.deepHandlers[track].close();
                }
        
                try {
                    // store in file
                    
                    // Create transcriptions directory if it doesn't exist
                    const transcriptionsDir = path.join(__dirname, 'transcriptions');
                    if (!fs.existsSync(transcriptionsDir)) {
                        fs.mkdirSync(transcriptionsDir, { recursive: true });
                    }
                    
                    // Write file to transcriptions folder
                    const filePath = path.join(transcriptionsDir, `transcription-${returnarray["callsid"]}.json`);
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