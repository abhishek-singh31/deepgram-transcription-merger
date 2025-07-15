require('dotenv').config();
const EventEmitter = require('events');
const WebSocket = require('ws');


class DeepgramService extends EventEmitter {
  constructor() {
    super();
    this.stream = null;
    this.streamCreatedAt = null;
    this.refresh = 0;
    this.correctedtime=0;
    this.primarylanguage="en-US";
    this.alternativelanguage="en-US";
    this.model="nova-2-general";
    this.redact=null;



    this.isopen = 0;
    this.buffer = [];
    this.writebuffer = true;
    this.isfirstresponse = true;
    this.offset = 0;
  }
  
  send(payload) {
    var stream = this.getStream()
    if(stream){
        if(this.isopen){
            if(this.writebuffer){
                this.writebuffer = false;
                this.buffer.forEach(element => {
                    stream.send(element);
                });
            }
            stream.send(payload);
        }else{
            this.buffer.push(payload);
        }
    }
  }

  close() {
    if (this.stream) {
      this.stream.close();
    }
  }

  newStreamRequired() {
    if (!this.stream) {
      return true;
    } else {
      const now = new Date();
      return false;
    }
  }

  getStream() {
    if (this.newStreamRequired()) {
      if (this.stream) {
        this.stream.close();
      }
      let model = this.model;
      let redact = this.redact;


      if(!model){
        model = "nova-2-general";
      }
      var request = "encoding=mulaw&sample_rate=8000&language="+this.primarylanguage+"&model="+model+"&smart_format=true&filler_words=true&no_delay=true&interim_results=true&vad_turnoff=60";
      if(redact != null){
        console.log("Redact is true");
        let redactquery = redact.split(",").map(value => `redact=${value}`).join("&"); //creating redaction query as redact=option1&redact=option2
        request = "encoding=mulaw&sample_rate=8000&language="+this.primarylanguage+"&model="+model+"&smart_format=true&filler_words=true&no_delay=true&interim_results=true&vad_turnoff=60&"+redactquery;
      }
      console.log('wss://api.deepgram.com/v1/listen?'+request);
      this.streamCreatedAt = new Date();
      var creds = process.env.DEEPGRAM_API_KEY;
      try {
        this.stream = new WebSocket('wss://api.deepgram.com/v1/listen?'+request,{
            headers: {
              Authorization: 'Token '+creds,
            },
        });
      } catch (e) {
        console.error('Error creating Deepgram WebSocket:', e);
      }

      var _this = this;
      this.stream.on('error',  (e) => {
        _this.emit('error', e);
      });

      this.stream.addEventListener('open', (event) => {
          this.isopen = 1;
          console.log("open",Date.now());
      });

      this.stream.addEventListener('close', (event) => {
          console.log('The connection has been closed successfully.');
          _this.emit('close', event);
        });
        

        var _this = this;
        this.stream.on('message', function incoming(data) {
            data =  JSON.parse(data);
            if(_this.isfirstresponse){
              _this.offset = (new Date() - _this.streamCreatedAt)/1000;
              console.log("offset",_this.offset);
              
              if(data.hasOwnProperty("metadata")){
                _this.emit('first-event', data.metadata);
              }
              _this.isfirstresponse = false;
            }
            if(data.hasOwnProperty('channel')){
              if(data["channel"]["alternatives"][0]["transcript"]!=""){
                  // console.log("from service");
                  // console.log("channel_index",data["channel_index"]);
                  // console.log(data["channel"]["alternatives"][0]["transcript"]);
                  const currentTime = new Date().getTime(); // last three digits contains the nano seconds
                  const durationSeconds = data.start;
                  const timeWhenPacketStartedProcessing = currentTime - parseInt(durationSeconds);
                  data.sno = timeWhenPacketStartedProcessing;
                  // console.log(JSON.stringify(data));
                  // console.log(convert(data));
                  _this.emit('transcription', convert(data,_this.offset));
                  _this.emit('txt', data);

              }
            }
        });
     
    }

    return this.stream;
  }


}


function convert(data,offset) {
    let endSecs = Math.floor(data.duration);
    let endNanos = (data.duration % 1).toFixed(4).substring(2,3)+"00000000";
    let words = [];
    data.channel.alternatives[0].words.forEach(element => {
              let startEndSecs = Math.floor(element.start);
              let startEndNanos = (element.start % 1).toFixed(4).substring(2,3)+"00000000";
              let endEndSecs = Math.floor(element.end);
              let endEndNanos = (element.end % 1).toFixed(4).substring(2,3)+"00000000";
              let word = {
                word:element.punctuated_word,
                startTime:{
                  seconds:startEndSecs,
                  nanos:startEndNanos,
                  finalseconds:startEndSecs,
                  finalnanos:startEndNanos
                },
                endTime:{
                  seconds:endEndSecs,
                  nanos:endEndNanos,
                  finalseconds:endEndSecs,
                  finalnanos:endEndNanos
                }
              };
              words.push(word);
            });
    
    var final = {
      results:[{
        alternatives:[{
          words:words,
          transcript:data.channel.alternatives[0].transcript,
          confidence:data.channel.alternatives[0].confidence
        }],
        isFinal:data.is_final,
        speechFinal:data.speech_final,
        resultEndTime:data.duration,
        resultEndTime: {
          seconds:endSecs,
          nanos:endNanos
        },
        sno:data.sno,
        requestid:data.metadata.request_id
        
      }]
    };
    return final;
}

module.exports = DeepgramService;