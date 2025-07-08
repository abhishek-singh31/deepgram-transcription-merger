const fs = require('fs');
const path = require('path');

// Function to read and parse a transcript file
function readTranscript(filename) {
  try {
      const filePath = path.join(__dirname, 'transcriptions', filename);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const transcript = JSON.parse(fileContent);
      return transcript;
  } catch (error) {
      console.error(`Error reading ${filename}:`, error.message);
      return null;
  }
}

// Function to convert seconds and nanos to absolute timestamp
function getAbsoluteTimestamp(baseTime, seconds, nanos) {
    const nanosAsSeconds = parseInt(nanos) / 1000000000;
    return baseTime + parseInt(seconds) + nanosAsSeconds;
}

// Function to create a more precise timestamp for sorting
function getPreciseTimestamp(baseTime, seconds, nanos) {
    return {
        absoluteTime: baseTime + parseInt(seconds) + (parseInt(nanos) / 1000000000),
        seconds: parseInt(seconds),
        nanos: parseInt(nanos)
    };
}

// Enhanced sorting function that handles nanoseconds precisely
function sortEntriesByTime(entries) {
    return entries.sort((a, b) => {
        // First, compare by absolute start time (including nanoseconds)
        const startTimeDiff = a.absoluteStartTime - b.absoluteStartTime;
        if (startTimeDiff !== 0) {
            return startTimeDiff;
        }
        
        // If start times are exactly the same, compare by absolute end time
        const endTimeDiff = a.absoluteEndTime - b.absoluteEndTime;
        if (endTimeDiff !== 0) {
            return endTimeDiff;
        }
        
        // If both start and end times are identical, sort by sequence number (sno)
        return a.sno - b.sno;
    });
}

// Function to merge all transcripts chronologically
function mergeTranscripts() {
    console.log('Merging all transcript files...');
    
    const transcriptFiles = fs.readdirSync(path.join(__dirname, 'transcriptions')).filter(file => file.endsWith('.json'));
    const allEntries = [];
    
    // First pass: collect all entries to find overall start time
    let overallStartTime = Infinity;
    const transcriptData = [];
    
    transcriptFiles.forEach((filename, index) => {
        console.log(`Processing ${filename}...`);
        
        const transcript = readTranscript(filename);
        if (!transcript || !transcript.transcription) {
            console.log(`Skipping ${filename} - no transcription data`);
            return;
        }
        
        const baseTime = transcript.startTime;
        transcriptData.push({ filename, transcript, baseTime });
        
        // Find the earliest start time across all transcripts
        if (baseTime < overallStartTime) {
            overallStartTime = baseTime;
        }
    });
    
    console.log(`Overall start time: ${overallStartTime}`);
    
    // Second pass: process entries with proper offsets
    transcriptData.forEach(({ filename, transcript, baseTime }) => {
        const offsetFromOverallStart = baseTime - overallStartTime;
        console.log(`${filename} offset: ${offsetFromOverallStart}s from overall start`);
        
        transcript.transcription.forEach(item => {
            if (item.results && item.results.length > 0) {
                const result = item.results[0];
                if (result.alternatives && result.alternatives.length > 0) {
                    const alternative = result.alternatives[0];
                    if (alternative.transcript && alternative.words && alternative.words.length > 0) {
                        const firstWord = alternative.words[0];
                        const lastWord = alternative.words[alternative.words.length - 1];
                        
                        // Calculate absolute timestamps for sorting
                        const absoluteStartTime = getAbsoluteTimestamp(
                            baseTime,
                            firstWord.startTime.seconds,
                            firstWord.startTime.nanos
                        );
                        
                        const absoluteEndTime = getAbsoluteTimestamp(
                            baseTime,
                            lastWord.endTime.seconds,
                            lastWord.endTime.nanos
                        );
                        
                        // Create updated words array with offset timestamps
                        const updatedWords = alternative.words.map(word => {
                            const wordStartTime = getAbsoluteTimestamp(
                                baseTime,
                                word.startTime.seconds,
                                word.startTime.nanos
                            );
                            const wordEndTime = getAbsoluteTimestamp(
                                baseTime,
                                word.endTime.seconds,
                                word.endTime.nanos
                            );
                            
                            // Calculate relative timestamps from overall start
                            const relativeStartTime = wordStartTime - overallStartTime;
                            const relativeEndTime = wordEndTime - overallStartTime;
                            
                            const relativeStartSeconds = Math.floor(relativeStartTime);
                            const relativeStartNanos = Math.floor((relativeStartTime - relativeStartSeconds) * 1000000000);
                            const relativeEndSeconds = Math.floor(relativeEndTime);
                            const relativeEndNanos = Math.floor((relativeEndTime - relativeEndSeconds) * 1000000000);
                            
                            return {
                                ...word,
                                startTime: {
                                    seconds: relativeStartSeconds,
                                    nanos: relativeStartNanos.toString(),
                                    finalseconds: relativeStartSeconds,
                                    finalnanos: relativeStartNanos.toString()
                                },
                                endTime: {
                                    seconds: relativeEndSeconds,
                                    nanos: relativeEndNanos.toString(),
                                    finalseconds: relativeEndSeconds,
                                    finalnanos: relativeEndNanos.toString()
                                }
                            };
                        });
                        
                        // Create precise timestamp objects for better sorting
                        const preciseStartTime = getPreciseTimestamp(
                            baseTime,
                            firstWord.startTime.seconds,
                            firstWord.startTime.nanos
                        );
                        
                        const preciseEndTime = getPreciseTimestamp(
                            baseTime,
                            lastWord.endTime.seconds,
                            lastWord.endTime.nanos
                        );
                        
                        allEntries.push({
                            absoluteStartTime,
                            absoluteEndTime,
                            preciseStartTime,
                            preciseEndTime,
                            participant_label: result.participant_label || 'unknown',
                            transcript: alternative.transcript,
                            confidence: alternative.confidence,
                            track: result.track,
                            words: updatedWords, // Use updated words with proper offsets
                            source_file: filename,
                            original_start_seconds: firstWord.startTime.seconds,
                            original_start_nanos: firstWord.startTime.nanos,
                            original_end_seconds: lastWord.endTime.seconds,
                            original_end_nanos: lastWord.endTime.nanos,
                            sno: result.sno,
                            requestid: result.requestid,
                            isFinal: result.isFinal,
                            speechFinal: result.speechFinal,
                            offsetFromOverallStart: offsetFromOverallStart
                        });
                    }
                }
            }
        });
    });
    
    // Sort all entries by precise timing (seconds + nanoseconds)
    const sortedEntries = sortEntriesByTime(allEntries);
    
    console.log(`Total entries found: ${sortedEntries.length}`);
    
    // Log some timing information for debugging
    console.log('\nFirst 5 entries with updated word timing:');
    sortedEntries.slice(0, 5).forEach((entry, index) => {
        const firstWord = entry.words[0];
        const lastWord = entry.words[entry.words.length - 1];
        console.log(`  ${index + 1}. [${entry.participant_label}] "${entry.transcript}" `
            + `(Word Start: ${firstWord.startTime.seconds}s ${firstWord.startTime.nanos}ns, `
            + `Word End: ${lastWord.endTime.seconds}s ${lastWord.endTime.nanos}ns, `
            + `Source: ${entry.source_file}, Offset: ${entry.offsetFromOverallStart}s)`);
    });
    
    // Calculate overall end time
    const overallEndTime = Math.max(...sortedEntries.map(entry => entry.absoluteEndTime));
    
    // Verify that word timestamps are in increasing order within each entry
    // Note: Words from different entries may overlap due to simultaneous speech
    console.log('\nVerifying word timestamp order...');
    let totalWordOrderIssues = 0;
    let simultaneousSpeechDetected = false;
    
    // Check for simultaneous speech between entries
    for (let i = 0; i < sortedEntries.length - 1; i++) {
        const currentEntry = sortedEntries[i];
        const nextEntry = sortedEntries[i + 1];
        
        // Check if entries overlap in time (simultaneous speech)
        if (currentEntry.absoluteEndTime > nextEntry.absoluteStartTime) {
            simultaneousSpeechDetected = true;
        }
    }
    
    if (simultaneousSpeechDetected) {
        console.log('📢 Simultaneous speech detected - this is normal for multi-participant conversations');
    }
    
    // Check word order within each entry
    for (let i = 0; i < sortedEntries.length; i++) {
        const entry = sortedEntries[i];
        let previousWordEndTime = -1;
        
        for (let j = 0; j < entry.words.length; j++) {
            const word = entry.words[j];
            const wordStartTime = parseInt(word.startTime.seconds) + parseInt(word.startTime.nanos) / 1000000000;
            const wordEndTime = parseInt(word.endTime.seconds) + parseInt(word.endTime.nanos) / 1000000000;
            
            // Check if word start time is after previous word end time within the same entry
            if (previousWordEndTime !== -1 && wordStartTime < previousWordEndTime) {
                console.log(`⚠️  Word order issue in entry ${i + 1} [${entry.participant_label}], word ${j + 1}: "${word.word}" starts at ${wordStartTime} but previous word ended at ${previousWordEndTime}`);
                totalWordOrderIssues++;
            }
            
            previousWordEndTime = wordEndTime;
        }
    }
    
    if (totalWordOrderIssues === 0) {
        console.log('✅ Word timestamps are in correct order within each entry');
    } else {
        console.log(`❌ Found ${totalWordOrderIssues} word ordering issues within entries`);
    }
    
    // Show timing statistics
    console.log('\nTiming Statistics:');
    console.log(`📊 Total duration: ${Math.floor(overallEndTime - overallStartTime)} seconds`);
    console.log(`📊 Entries with simultaneous speech: ${simultaneousSpeechDetected ? 'Yes' : 'No'}`);
    console.log(`📊 Transcript file time ranges:`);
    transcriptData.forEach(({ filename, baseTime }) => {
        const offset = baseTime - overallStartTime;
        console.log(`   ${filename}: starts at +${offset}s`);
    });
    
    // Create combined transcript structure
    const combinedTranscript = {
        transcription: sortedEntries.map(entry => ({
            results: [{
                alternatives: [{
                    words: entry.words,
                    transcript: entry.transcript,
                    confidence: entry.confidence
                }],
                isFinal: entry.isFinal,
                speechFinal: entry.speechFinal,
                participant_label: entry.participant_label,
                track: entry.track,
                sno: entry.sno,
                requestid: entry.requestid,
                absoluteStartTime: entry.absoluteStartTime,
                absoluteEndTime: entry.absoluteEndTime,
                preciseStartTime: entry.preciseStartTime,
                preciseEndTime: entry.preciseEndTime,
                source_file: entry.source_file,
                offsetFromOverallStart: entry.offsetFromOverallStart
            }]
        })),
        completetranscription: sortedEntries.map(entry => `${entry.transcript}`).join(' '),
        datetime: Math.floor(overallEndTime),
        startTime: Math.floor(overallStartTime),
        endTime: Math.floor(overallEndTime),
        totalDuration: Math.floor(overallEndTime - overallStartTime),
        totalEntries: sortedEntries.length,
        participants: [...new Set(sortedEntries.map(entry => entry.participant_label))],
        sourceFiles: transcriptFiles,
        mergedAt: new Date().toISOString(),
        sortingInfo: {
            description: "Entries sorted by start time (seconds + nanoseconds), then by end time, then by sequence number",
            precisionLevel: "nanoseconds",
            wordTimestamps: "Word-level timestamps are relative to overall transcript start time and in increasing order"
        }
    };
    
    return combinedTranscript;
}

// Function to save combined transcript to file
function saveCombinedTranscript(combinedTranscript, filename = 'combined-transcription.json') {
    try {
        const filePath = path.join(__dirname, 'transcriptions', filename);
        fs.readdirSync(path.join(__dirname, 'transcriptions')).forEach(file => {
          fs.unlinkSync(path.join(__dirname, 'transcriptions', file));
        });
        const jsonString = JSON.stringify(combinedTranscript, null, 2);
        fs.writeFileSync(filePath, jsonString, 'utf8');
        console.log(`Combined transcription saved to ${filename}`);
        console.log(`Total duration: ${combinedTranscript.totalDuration} seconds`);
        console.log(`Total entries: ${combinedTranscript.totalEntries}`);
        console.log(`Participants: ${combinedTranscript.participants.join(', ')}`);
        return true;
    } catch (error) {
        console.error(`Error saving combined transcript:`, error.message);
        return false;
    }
}

// Generate combined transcription
console.log('\n' + '='.repeat(60));
console.log('GENERATING COMBINED TRANSCRIPTION');
console.log('='.repeat(60));

const combinedTranscript = mergeTranscripts();
const success = saveCombinedTranscript(combinedTranscript);

if (success) {
    console.log('\n✅ Combined transcription generated successfully!');
} else {
    console.log('\n❌ Failed to generate combined transcription');
}
