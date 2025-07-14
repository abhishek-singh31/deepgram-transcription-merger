const fs = require('fs');
const path = require('path');

function mergeTranscripts(){
  const transcriptFiles = fs.readdirSync(path.join(__dirname, 'transcription3')).filter(file => file.endsWith('.json'));
  // identity transcription with metaData.customParameters.call_flow_type = normal
  const parentFile = transcriptFiles.find(file => JSON.parse(fs.readFileSync(path.join(__dirname, 'transcription3', file), 'utf8')).metadata.customParameters.call_flow_type === 'normal');
  const parentTranscription = JSON.parse(fs.readFileSync(path.join(__dirname, 'transcription3', parentFile), 'utf8'));

  // const trackMap = new Map();
  // const customerLabel = parentTranscription.metadata.customParameters.track1_label;
  // console.log('customerLabel', customerLabel);
  // let currentTrackCount = 1;
  // trackMap.set(parentTranscription.metadata.customParameters.track0_label, 0);
  // trackMap.set(parentTranscription.metadata.customParameters.track1_label, 1);

  // console.log('Currently trackMap', trackMap); 
 
  // const totalCallDuration = 146; // we need this somehow for correct mapping
  const baseEndTime = parentTranscription.endTime;
  const baseCallDuration = parentTranscription.callduration; // 66
  const otherTranscriptionFiles = transcriptFiles.filter(file => file !== parentFile);

  // Array to store all processed transcriptions
  const allTranscriptions = [parentTranscription];
  const allCallDurations = [baseCallDuration];

  // let conferenceCallDuration = 0;
  // otherTranscriptionFiles.forEach((file) => {
  //   const transcription = JSON.parse(fs.readFileSync(path.join(__dirname, 'transcription3', file), 'utf8'));
  //   conferenceCallDuration = transcription.callduration > conferenceCallDuration ? transcription.callduration : conferenceCallDuration;
  // })

  // console.log('baseCallDuration:', baseCallDuration);
  // console.log('conferenceCallDuration:', conferenceCallDuration);
  // console.log('totalCallDuration:', totalCallDuration);
  
  // const callDurationDiff = Math.abs(baseCallDuration + conferenceCallDuration - totalCallDuration);
  // console.log('callDurationDiff:', callDurationDiff);
  

  otherTranscriptionFiles.forEach((file) => {
    // for each transcription we have to add (offset = this file startTime - baseEndTime) in every word startTime and endTime
    const transcription = JSON.parse(fs.readFileSync(path.join(__dirname, 'transcription3', file), 'utf8'));
    // let extraOffset = 4;
    // const participantLabel = transcription.metadata.customParameters.track1_label;
    // if(participantLabel === "debjyoti"){
    //   extraOffset = 5;
    // }
    console.log('transcription.startTime', transcription.startTime);
    console.log('baseEndTime', baseEndTime);
    console.log('baseCallDuration', baseCallDuration);
    const offset = (transcription.metadata.customParameters.stream_start_time_in_epoch_seconds - baseEndTime) + baseCallDuration - (transcription.metadata.customParameters.delta_time_in_epoch_seconds);
    console.log('offset', offset);
    //  - (callDurationDiff);

    // console.log('participantLabel', participantLabel);
    // console.log('trackMap', trackMap);

    // let track = 0;
    // if(trackMap.has(participantLabel)){
    //   track = trackMap.get(participantLabel);
    // } else {
    //   currentTrackCount++;
    //   trackMap.set(participantLabel, currentTrackCount);
    //   track = currentTrackCount;
    // }
    transcription.transcription.forEach(segment => {
      segment.results.forEach(result => {
        result.alternatives.forEach(alternative => {
          alternative.words.forEach(word => {
            word.startTime.seconds += offset;
            word.startTime.finalseconds += offset;
            word.endTime.seconds += offset;
            word.endTime.finalseconds += offset;
          });
        });
        // result.track = track;
      });
    });
    // now from this, create new json with name transcription-{transcription.metadata.customParameters.track1_label}
    // fs.writeFileSync(path.join(__dirname, 'transcription3', `transcription-${transcription.metadata.customParameters.track1_label}.json`), JSON.stringify(transcription, null, 2));

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

mergeTranscripts();