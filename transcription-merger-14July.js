require('dotenv').config();
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const client = twilio(accountSid, authToken);

async function mergeTranscripts(){
  const transcriptFiles = fs.readdirSync(path.join(__dirname, 'transcription3')).filter(file => file.endsWith('.json'));
  // identity transcription with metaData.customParameters.call_flow_type = normal
  const parentFile = transcriptFiles.find(file => JSON.parse(fs.readFileSync(path.join(__dirname, 'transcription3', file), 'utf8')).metadata.customParameters.call_flow_type === 'normal');
  const parentTranscription = JSON.parse(fs.readFileSync(path.join(__dirname, 'transcription3', parentFile), 'utf8'));

  const baseCallDuration = parentTranscription.callduration;
  let baseCallRecordingLength = baseCallDuration;
  await client.recordings
  .list({ callSid: parentTranscription.metadata.callSid })
  .then(recordings => {
    recordings.forEach(rec => {
      baseCallRecordingLength = parseInt(rec.duration);
    });
  })
  .catch(err => {
    console.error('Error fetching recordings:', err);
  });

  const otherTranscriptionFiles = transcriptFiles.filter(file => file !== parentFile);

  // Array to store all processed transcriptions
  const allTranscriptions = [parentTranscription];
  const allCallDurations = [baseCallDuration];


  let conferenceRecordingTime = 0;
  otherTranscriptionFiles.forEach((file) => {
    // find conferenceRecrodingTime;
    const transcription = JSON.parse(fs.readFileSync(path.join(__dirname, 'transcription3', file), 'utf8'));
    conferenceRecordingTime = Math.max(transcription.metadata.customParameters.recording_start_time_in_epoch_seconds, conferenceRecordingTime);
  })
  console.log("conferenceRecordingTime", conferenceRecordingTime);


  const {seconds: confereceStartTimeSeconds, nanos: confereceStartTimeNanos} = splitEpochSeconds(parseFloat(conferenceRecordingTime));


  otherTranscriptionFiles.forEach((file) => {
    // for each transcription we have to add (offset = this file startTime - baseEndTime) in every word startTime and endTime
    const transcription = JSON.parse(fs.readFileSync(path.join(__dirname, 'transcription3', file), 'utf8'));
    const {seconds: streamStartTimeSeconds, nanos: streamStartTimeNanos} = splitEpochSeconds(parseFloat(transcription.metadata.customParameters.stream_start_time_in_epoch_seconds));
    
    const deltaTimeSeconds = streamStartTimeSeconds - confereceStartTimeSeconds;
    const deltaTimeNanos = streamStartTimeNanos - confereceStartTimeNanos;
    
    const offsetSeconds = deltaTimeSeconds;
    const offsetNanos = deltaTimeNanos;
    

    transcription.transcription.forEach(segment => {
      segment.results.forEach(result => {
        result.alternatives.forEach(alternative => {
          alternative.words.forEach(word => {
            // Apply time offset to both startTime and endTime
            addTimeOffset(word.startTime, offsetSeconds + baseCallRecordingLength, offsetNanos);
            addTimeOffset(word.endTime, offsetSeconds + baseCallRecordingLength, offsetNanos);
          });
        });
      });
    });

    // now from this, create new json with name transcription-{transcription.metadata.customParameters.track1_label}-modified
    // fs.writeFileSync(path.join(__dirname, 'transcription3', `transcription-${transcription.metadata.customParameters.track1_label}-modified.json`), JSON.stringify(transcription, null, 2));
    // Add to our collections for final merge
    allTranscriptions.push(transcription);
    allCallDurations.push(transcription.callduration);
  });

  // Now create a single combined JSON file
  const combinedTranscription = createCombinedTranscription(allTranscriptions, allCallDurations, baseCallDuration);
  fs.writeFileSync(path.join(__dirname, 'transcription3', 'combined-transcription.json'), JSON.stringify(combinedTranscription, null, 2));
  
  console.log('Combined transcription created successfully!');
}

function createCombinedTranscription(allTranscriptions, allCallDurations, baseCallDuration) {
  // Collect all words from all transcriptions
  const allWords = [];
  
  allTranscriptions.forEach(transcription => {
    transcription.transcription.forEach(segment => {
      segment.results.forEach(result => {
        result.alternatives.forEach(alternative => {
          alternative.words.forEach(word => {
            allWords.push({
              word: word.word,
              startTime: word.startTime,
              endTime: word.endTime,
              participant_label: result.participant_label,
              track: result.track
            });
          });
        });
      });
    });
  });

  // Sort words according to the specified criteria
  allWords.sort((a, b) => {
    // Primary: startTime seconds
    if (a.startTime.seconds !== b.startTime.seconds) {
      return a.startTime.seconds - b.startTime.seconds;
    }
    
    // Secondary: startTime nanos
    const aNanos = parseInt(a.startTime.nanos);
    const bNanos = parseInt(b.startTime.nanos);
    if (aNanos !== bNanos) {
      return aNanos - bNanos;
    }
    
    // Tertiary: endTime seconds
    if (a.endTime.seconds !== b.endTime.seconds) {
      return a.endTime.seconds - b.endTime.seconds;
    }
    
    // Quaternary: endTime nanos
    const aEndNanos = parseInt(a.endTime.nanos);
    const bEndNanos = parseInt(b.endTime.nanos);
    if (aEndNanos !== bEndNanos) {
      return aEndNanos - bEndNanos;
    }
    
    // Final: word text
    return a.word.localeCompare(b.word);
  });

  // Calculate global values
  const globalStartTime = Math.min(...allTranscriptions.map(t => t.startTime));
  const globalEndTime = Math.max(...allTranscriptions.map(t => t.endTime));
  const otherCallDurations = allCallDurations.filter((_, index) => index > 0);
  const globalCallDuration = baseCallDuration + (otherCallDurations.length > 0 ? Math.max(...otherCallDurations) : 0);

  // Create the combined transcription structure
  const combinedTranscription = {
    transcription: [],
    completetranscription: "",
    datetime: Math.max(...allTranscriptions.map(t => t.datetime)),
    startTime: globalStartTime,
    endTime: globalEndTime,
    metadata: {
      ...allTranscriptions[0].metadata,
      customParameters: {
        ...allTranscriptions[0].metadata.customParameters,
        call_flow_type: "merged"
      }
    },
    callduration: globalCallDuration,
    callsid: "combined"
  };

  // Group words by participant and create segments
  const segmentsByParticipant = {};
  let currentSegment = null;
  let currentParticipant = null;

  allWords.forEach(word => {
    if (currentParticipant !== word.participant_label) {
      // Start new segment
      if (currentSegment) {
        // Save previous segment
        if (!segmentsByParticipant[currentParticipant]) {
          segmentsByParticipant[currentParticipant] = [];
        }
        segmentsByParticipant[currentParticipant].push(currentSegment);
      }
      
      currentParticipant = word.participant_label;
      currentSegment = {
        results: [{
          alternatives: [{
            words: [word],
            transcript: word.word,
            confidence: 1.0
          }],
          isFinal: true,
          speechFinal: false,
          resultEndTime: word.endTime,
          sno: Date.now(),
          requestid: "combined-" + Date.now(),
          track: word.track,
          participant_label: word.participant_label
        }]
      };
    } else {
      // Add word to current segment
      currentSegment.results[0].alternatives[0].words.push(word);
      currentSegment.results[0].alternatives[0].transcript += " " + word.word;
      currentSegment.results[0].resultEndTime = word.endTime;
    }
  });

  // Save final segment
  if (currentSegment && currentParticipant) {
    if (!segmentsByParticipant[currentParticipant]) {
      segmentsByParticipant[currentParticipant] = [];
    }
    segmentsByParticipant[currentParticipant].push(currentSegment);
  }

  // Convert segments back to transcription array sorted by time
  const allSegments = [];
  Object.values(segmentsByParticipant).forEach(segments => {
    allSegments.push(...segments);
  });

  // Sort segments by first word start time
  allSegments.sort((a, b) => {
    const aFirstWord = a.results[0].alternatives[0].words[0];
    const bFirstWord = b.results[0].alternatives[0].words[0];
    
    if (aFirstWord.startTime.seconds !== bFirstWord.startTime.seconds) {
      return aFirstWord.startTime.seconds - bFirstWord.startTime.seconds;
    }
    
    return parseInt(aFirstWord.startTime.nanos) - parseInt(bFirstWord.startTime.nanos);
  });

  combinedTranscription.transcription = allSegments;
  
  // Create complete transcription text
  combinedTranscription.completetranscription = allWords.map(word => word.word).join(" ");

  return combinedTranscription;
}

function splitEpochSeconds(epochDecimal) {
  const seconds = Math.floor(epochDecimal);
  const nanos = Math.round((epochDecimal - seconds) * 1_000_000_000);
  return { seconds, nanos };
}

function addTimeOffset(timeObj, offsetSeconds, offsetNanos) {
  const NANOS_PER_SECOND = 1_000_000_000;

  // Add seconds offset
  timeObj.seconds += offsetSeconds;
  timeObj.finalseconds += offsetSeconds;
  
  // Add nanoseconds offset and handle overflow
  let totalNanos = parseInt(timeObj.nanos) + parseInt(offsetNanos);
  let totalFinalNanos = parseInt(timeObj.finalnanos) + parseInt(offsetNanos);

  // Handle nanosecond overflow for nanos
  if (totalNanos >= NANOS_PER_SECOND) {
    timeObj.seconds += Math.floor(totalNanos / NANOS_PER_SECOND);
    timeObj.nanos = convertNanosToString(totalNanos % NANOS_PER_SECOND);
  } else {
    timeObj.nanos = convertNanosToString(totalNanos);
  }
  
  // Handle nanosecond overflow for finalnanos
  if (totalFinalNanos >= NANOS_PER_SECOND) {
    timeObj.finalseconds += Math.floor(totalFinalNanos / NANOS_PER_SECOND);
    timeObj.finalnanos = convertNanosToString(totalFinalNanos % NANOS_PER_SECOND);
  } else {
    timeObj.finalnanos = convertNanosToString(totalFinalNanos);
  }
}

function convertNanosToString(nanos) {
  let nanosString = `${nanos}`;
  while(nanosString.length < 9){
    nanosString = '0' + nanosString;
  }
  return nanosString;
}

mergeTranscripts();