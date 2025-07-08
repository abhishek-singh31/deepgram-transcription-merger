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
    
    // Read all transcript files and extract entries
    transcriptFiles.forEach((filename, index) => {
        console.log(`Processing ${filename}...`);
        
        const transcript = readTranscript(filename);
        if (!transcript || !transcript.transcription) {
            console.log(`Skipping ${filename} - no transcription data`);
            return;
        }
        
        const baseTime = transcript.startTime;
        
        transcript.transcription.forEach(item => {
            if (item.results && item.results.length > 0) {
                const result = item.results[0];
                if (result.alternatives && result.alternatives.length > 0) {
                    const alternative = result.alternatives[0];
                    if (alternative.transcript && alternative.words && alternative.words.length > 0) {
                        const firstWord = alternative.words[0];
                        const lastWord = alternative.words[alternative.words.length - 1];
                        
                        // Calculate absolute timestamps with high precision
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
                            words: alternative.words,
                            source_file: filename,
                            original_start_seconds: firstWord.startTime.seconds,
                            original_start_nanos: firstWord.startTime.nanos,
                            original_end_seconds: lastWord.endTime.seconds,
                            original_end_nanos: lastWord.endTime.nanos,
                            sno: result.sno,
                            requestid: result.requestid,
                            isFinal: result.isFinal,
                            speechFinal: result.speechFinal
                        });
                    }
                }
            }
        });
    });
    
    // Sort all entries by precise timing (seconds + nanoseconds)
    const sortedEntries = sortEntriesByTime(allEntries);
    
    console.log(`Total entries found: ${sortedEntries.length}`);
    
    // Calculate overall start and end times
    const overallStartTime = Math.min(...sortedEntries.map(entry => entry.absoluteStartTime));
    const overallEndTime = Math.max(...sortedEntries.map(entry => entry.absoluteEndTime));
    
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
                source_file: entry.source_file
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
            precisionLevel: "nanoseconds"
        }
    };
    
    return combinedTranscript;
}

// Function to save combined transcript to file
function saveCombinedTranscript(combinedTranscript, filename = 'combined-transcription.json') {
    try {
        const filePath = path.join(__dirname, 'transcriptions', filename);
        // delete all existing files in transcriptions folder
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

// Export for potential use in other modules
module.exports = {
    readTranscript,
    mergeTranscripts,
    saveCombinedTranscript
};
