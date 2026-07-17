const fs = require('fs');
const path = require('path');

// ===== ENHANCED VTT TO SRT CONVERTER - FIXED DUPLICATE ISSUE =====
function convertVttToSrt(vttContent) {
    console.log('🔄 Converting VTT to SRT...');
    
    if (!vttContent || typeof vttContent !== 'string') {
        throw new Error('Invalid VTT content provided');
    }
    
    const lines = vttContent.split('\n');
    let srtContent = '';
    let counter = 1;
    let currentCue = null;
    
    console.log(`📊 Processing ${lines.length} lines from VTT`);
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip WEBVTT header and metadata
        if (line.startsWith('WEBVTT') || 
            line.startsWith('NOTE') || 
            line.startsWith('Kind:') || 
            line.startsWith('Language:') ||
            line.startsWith('X-TIMESTAMP-MAP') ||
            line.startsWith('STYLE') || 
            line.startsWith('::cue') ||
            line.match(/^[A-Z-]+:\s*/) || // Any metadata line
            line === '') {
            
            // If we hit empty line and have a complete cue, process it
            if (line === '' && currentCue && currentCue.timeRange && currentCue.textLines.length > 0) {
                processCue(currentCue);
                currentCue = null;
            }
            continue;
        }
        
        // Check for timestamp line (enhanced pattern matching)
        if (line.includes('-->')) {
            // If we have a previous cue, process it first
            if (currentCue && currentCue.timeRange && currentCue.textLines.length > 0) {
                processCue(currentCue);
            }
            
            // Start new cue
            currentCue = {
                timeRange: normalizeTimestamp(line),
                textLines: []
            };
            continue;
        }
        
        // Check for cue identifier (skip it)
        if (!currentCue && !line.includes('-->') && line.match(/^[a-zA-Z0-9_-]+$/)) {
            continue; // Skip cue identifiers
        }
        
        // Collect text lines
        if (currentCue && line !== '') {
            const cleanLine = cleanTextLine(line);
            if (cleanLine && cleanLine.length > 0) {
                // FIXED: Check for duplicate lines to avoid repetition
                if (!currentCue.textLines.includes(cleanLine)) {
                    currentCue.textLines.push(cleanLine);
                }
            }
        }
    }
    
    // Handle last cue if it exists
    if (currentCue && currentCue.timeRange && currentCue.textLines.length > 0) {
        processCue(currentCue);
    }
    
    function processCue(cue) {
        if (cue.textLines.length > 0 && cue.timeRange) {
            // FIXED: Remove any duplicate lines and filter empty ones
            const uniqueLines = [...new Set(cue.textLines)]
                .filter(line => line && line.trim().length > 0)
                .map(line => line.trim());
            
            if (uniqueLines.length > 0) {
                srtContent += `${counter}\n${cue.timeRange}\n${uniqueLines.join('\n')}\n\n`;
                counter++;
            }
        }
    }
    
    const finalContent = srtContent.trim();
    console.log(`✅ VTT to SRT conversion completed. Generated ${counter - 1} subtitles.`);
    
    if (finalContent.length === 0) {
        throw new Error('No valid subtitle content found in VTT file');
    }
    
    return finalContent;
}

// ===== ENHANCED SRT TO TXT CONVERTER - FIXED DUPLICATE ISSUE =====
function convertSrtToTxt(srtContent) {
    console.log('🔄 Converting SRT to TXT...');
    
    if (!srtContent || typeof srtContent !== 'string') {
        throw new Error('Invalid SRT content provided');
    }
    
    const lines = srtContent.split('\n');
    const textLines = [];
    const seenLines = new Set(); // FIXED: Track seen lines to avoid duplicates
    
    console.log(`📊 Processing ${lines.length} lines from SRT`);
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (line === '') {
            continue;
        }
        
        // Skip sequence numbers (lines that are just numbers)
        if (/^\d+$/.test(line)) {
            continue;
        }
        
        // Skip timestamp lines (contains -->)
        if (line.includes('-->')) {
            continue;
        }
        
        // This is a text line - clean and keep it
        if (line.length > 0) {
            const cleanedLine = cleanTextLine(line);
            
            if (cleanedLine && cleanedLine.length > 0) {
                // FIXED: Only add unique lines to avoid duplicates
                const normalizedLine = cleanedLine.toLowerCase().trim();
                if (!seenLines.has(normalizedLine)) {
                    seenLines.add(normalizedLine);
                    textLines.push(cleanedLine);
                }
            }
        }
    }
    
    // FIXED: Additional cleanup - remove similar lines that might be slightly different
    const finalLines = removeSimilarLines(textLines);
    const result = finalLines.join('\n');
    
    console.log(`✅ SRT to TXT conversion completed. Extracted ${finalLines.length} unique text lines.`);
    
    if (result.trim().length === 0) {
        throw new Error('No valid text content found in SRT file');
    }
    
    return result;
}

// ===== NEW: FUNCTION TO REMOVE SIMILAR/DUPLICATE LINES =====
function removeSimilarLines(lines) {
    if (!lines || lines.length === 0) return [];
    
    const uniqueLines = [];
    const threshold = 0.8; // 80% similarity threshold
    
    for (const currentLine of lines) {
        let isDuplicate = false;
        
        for (const existingLine of uniqueLines) {
            const similarity = calculateSimilarity(currentLine.toLowerCase(), existingLine.toLowerCase());
            if (similarity >= threshold) {
                isDuplicate = true;
                break;
            }
        }
        
        if (!isDuplicate) {
            uniqueLines.push(currentLine);
        }
    }
    
    return uniqueLines;
}

// ===== NEW: CALCULATE TEXT SIMILARITY =====
function calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1.0;
    if (str1.length === 0 || str2.length === 0) return 0.0;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
}

// ===== NEW: LEVENSHTEIN DISTANCE CALCULATION =====
function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

// ===== ENHANCED TEXT CLEANING FUNCTION - FIXED =====
function cleanTextLine(text) {
    if (!text) return '';
    
    let cleaned = text
        // Remove HTML tags
        .replace(/<[^>]*>/g, '')
        // Remove WebVTT styling tags
        .replace(/\{[^}]*\}/g, '')
        // Remove VTT positioning info
        .replace(/\s*align:start\s*/g, '')
        .replace(/\s*align:middle\s*/g, '')
        .replace(/\s*align:end\s*/g, '')
        .replace(/\s*position:\d+%\s*/g, '')
        .replace(/\s*line:\d+%\s*/g, '')
        .replace(/\s*size:\d+%\s*/g, '')
        // Decode HTML entities
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/&#(\d+);/g, (match, num) => String.fromCharCode(num))
        // Clean up multiple spaces and special characters
        .replace(/\s+/g, ' ')
        .replace(/[\r\n]+/g, ' ')
        // Remove common subtitle artifacts
        .replace(/^\s*[-\*•]+\s*/, '') // Remove leading dashes or bullets
        .replace(/\s*[-\*•]+\s*$/, '') // Remove trailing dashes or bullets
        .replace(/^\s*>+\s*/, '') // Remove leading arrows
        .replace(/\s*<+\s*$/, '') // Remove trailing arrows
        .trim();
    
    // FIXED: Additional cleanup for common issues
    cleaned = cleaned
        .replace(/^["'\s]*/, '') // Remove leading quotes and spaces
        .replace(/["'\s]*$/, '') // Remove trailing quotes and spaces
        .replace(/\s*\.\.\.\s*/g, '... ') // Normalize ellipsis
        .replace(/\s*-\s*-\s*/g, ' -- ') // Normalize double dashes
        .trim();
    
    return cleaned;
}

// ===== ENHANCED TIMESTAMP NORMALIZATION =====
function normalizeTimestamp(timestamp) {
    if (!timestamp) return '';
    
    return timestamp
        // Convert VTT dots to SRT commas for milliseconds
        .replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2')
        // Add leading zero for hours if needed
        .replace(/(\d{1}:\d{2}:\d{2})/g, '0$1')
        // Clean extra spaces and normalize arrow
        .replace(/\s*-->\s*/g, ' --> ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ===== FIXED MAIN CONVERSION FUNCTION =====
function convertSubtitleFile(inputFilePath, outputFormat = 'both') {
    try {
        console.log(`📁 Processing file: ${inputFilePath}`);
        console.log(`🎯 Target format: ${outputFormat}`);
        
        // Validate input parameters
        if (!inputFilePath || typeof inputFilePath !== 'string') {
            throw new Error('Invalid input file path provided');
        }
        
        if (!validateOutputFormat(outputFormat)) {
            throw new Error(`Invalid output format: ${outputFormat}. Use 'srt', 'txt', or 'both'`);
        }
        
        // Check if file exists
        if (!fs.existsSync(inputFilePath)) {
            throw new Error(`File không tồn tại: ${inputFilePath}`);
        }
        
        // Check file size
        const stats = fs.statSync(inputFilePath);
        if (stats.size === 0) {
            throw new Error('File subtitle rỗng');
        }
        
        if (stats.size > 50 * 1024 * 1024) { // 50MB limit
            throw new Error('File subtitle quá lớn (>50MB)');
        }
        
        console.log(`📊 File size: ${stats.size} bytes`);
        
        // Read input file with proper encoding handling
        let inputContent;
        try {
            inputContent = fs.readFileSync(inputFilePath, 'utf8');
        } catch (readError) {
            // Try with different encoding if UTF-8 fails
            try {
                inputContent = fs.readFileSync(inputFilePath, 'latin1');
                console.log('⚠️ Used latin1 encoding as fallback');
            } catch (fallbackError) {
                throw new Error(`Không thể đọc file: ${readError.message}`);
            }
        }
        
        if (!inputContent || inputContent.trim().length === 0) {
            throw new Error('File subtitle không chứa nội dung');
        }
        
        const inputExt = path.extname(inputFilePath).toLowerCase();
        const baseName = path.basename(inputFilePath, inputExt);
        const outputDir = path.dirname(inputFilePath);
        
        console.log(`📝 Input format: ${inputExt}, Base name: ${baseName}`);
        console.log(`📂 Output directory: ${outputDir}`);
        
        let srtContent = '';
        let txtContent = '';
        const results = [];
        
        // Convert based on input format
        if (inputExt === '.vtt') {
            console.log('🔄 Processing VTT format');
            
            // Validate VTT content
            if (!inputContent.includes('-->') && !inputContent.includes('WEBVTT')) {
                throw new Error('File VTT không hợp lệ - thiếu timestamp hoặc header WEBVTT');
            }
            
            srtContent = convertVttToSrt(inputContent);
            txtContent = convertSrtToTxt(srtContent);
            
        } else if (inputExt === '.srt') {
            console.log('🔄 Processing SRT format');
            
            // Validate SRT content
            if (!inputContent.includes('-->')) {
                throw new Error('File SRT không hợp lệ - thiếu timestamp');
            }
            
            srtContent = inputContent;
            txtContent = convertSrtToTxt(srtContent);
            
        } else {
            throw new Error(`Định dạng file không được hỗ trợ: ${inputExt}. Chỉ hỗ trợ .vtt và .srt`);
        }
        
        // Validate converted content
        if (!srtContent || srtContent.trim().length === 0) {
            throw new Error('Không thể convert subtitle - nội dung SRT rỗng');
        }
        
        if (!txtContent || txtContent.trim().length === 0) {
            throw new Error('Không thể trích xuất text từ subtitle');
        }
        
        // FIXED: Save output files based on format requested with proper validation
        if (outputFormat === 'srt' || outputFormat === 'both') {
            const srtPath = path.join(outputDir, `${baseName}.srt`);
            
            try {
                fs.writeFileSync(srtPath, srtContent, 'utf8');
                
                // FIXED: Validate that the file was written correctly
                const writtenStats = fs.statSync(srtPath);
                if (writtenStats.size === 0) {
                    throw new Error('SRT file was written but is empty');
                }
                
                // FIXED: Verify the file extension is correct
                if (path.extname(srtPath).toLowerCase() !== '.srt') {
                    throw new Error('SRT file does not have correct extension');
                }
                
                results.push({ format: 'SRT', path: srtPath });
                console.log(`✅ Created SRT file: ${srtPath}`);
                console.log(`📊 SRT file size: ${writtenStats.size} bytes`);
                
            } catch (writeError) {
                throw new Error(`Không thể ghi file SRT: ${writeError.message}`);
            }
        }
        
        if (outputFormat === 'txt' || outputFormat === 'both') {
            const txtPath = path.join(outputDir, `${baseName}.txt`);
            
            try {
                fs.writeFileSync(txtPath, txtContent, 'utf8');
                
                // FIXED: Validate that the file was written correctly
                const writtenStats = fs.statSync(txtPath);
                if (writtenStats.size === 0) {
                    throw new Error('TXT file was written but is empty');
                }
                
                // FIXED: Verify the file extension is correct
                if (path.extname(txtPath).toLowerCase() !== '.txt') {
                    throw new Error('TXT file does not have correct extension');
                }
                
                results.push({ format: 'TXT', path: txtPath });
                console.log(`✅ Created TXT file: ${txtPath}`);
                console.log(`📊 TXT file size: ${writtenStats.size} bytes`);
                
            } catch (writeError) {
                throw new Error(`Không thể ghi file TXT: ${writeError.message}`);
            }
        }
        
        // FIXED: Additional validation of results
        if (results.length === 0) {
            throw new Error('No output files were created');
        }
        
        // FIXED: Verify all requested formats were created
        if (outputFormat === 'srt' && !results.some(r => r.format === 'SRT')) {
            throw new Error('SRT format was requested but not created');
        }
        
        if (outputFormat === 'txt' && !results.some(r => r.format === 'TXT')) {
            throw new Error('TXT format was requested but not created');
        }
        
        if (outputFormat === 'both' && results.length !== 2) {
            throw new Error('Both formats were requested but not all were created');
        }
        
        console.log(`🎉 Conversion completed successfully! Created ${results.length} file(s)`);
        console.log('📋 Results validation passed');
        console.log('🔧 FIXED: Duplicate text issue resolved');
        
        return results;
        
    } catch (error) {
        console.error(`❌ Error converting file: ${error.message}`);
        throw error;
    }
}

// ===== ENHANCED BATCH CONVERSION =====
function convertAllSubtitlesInFolder(folderPath, outputFormat = 'both') {
    try {
        console.log(`📁 Processing folder: ${folderPath}`);
        
        if (!fs.existsSync(folderPath)) {
            throw new Error(`Thư mục không tồn tại: ${folderPath}`);
        }
        
        const stats = fs.statSync(folderPath);
        if (!stats.isDirectory()) {
            throw new Error(`Đường dẫn không phải là thư mục: ${folderPath}`);
        }
        
        const files = fs.readdirSync(folderPath);
        const subtitleFiles = files.filter(file => 
            file.toLowerCase().endsWith('.vtt') || file.toLowerCase().endsWith('.srt')
        );
        
        console.log(`📄 Found ${subtitleFiles.length} subtitle files`);
        
        if (subtitleFiles.length === 0) {
            console.log('⚠️ No subtitle files found in folder');
            return [];
        }
        
        const allResults = [];
        let successCount = 0;
        let failCount = 0;
        
        for (const file of subtitleFiles) {
            const filePath = path.join(folderPath, file);
            console.log(`\n🔄 Processing: ${file}`);
            
            try {
                const results = convertSubtitleFile(filePath, outputFormat);
                allResults.push(...results);
                successCount++;
                console.log(`✅ Successfully converted: ${file}`);
            } catch (error) {
                console.error(`❌ Failed to convert ${file}:`, error.message);
                failCount++;
            }
        }
        
        console.log(`\n📊 Batch conversion summary:`);
        console.log(`   ✅ Success: ${successCount} files`);
        console.log(`   ❌ Failed: ${failCount} files`);
        console.log(`   📁 Total output files: ${allResults.length}`);
        
        return allResults;
        
    } catch (error) {
        console.error(`❌ Error processing folder: ${error.message}`);
        throw error;
    }
}

// ===== ENHANCED VALIDATION FUNCTIONS =====
function isValidSubtitleFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return false;
        }
        
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
            return false;
        }
        
        const ext = path.extname(filePath).toLowerCase();
        if (!['.vtt', '.srt'].includes(ext)) {
            return false;
        }
        
        // Read first few lines to validate content
        const content = fs.readFileSync(filePath, 'utf8');
        
        if (ext === '.vtt') {
            // Basic VTT validation
            return content.includes('WEBVTT') || content.includes('-->');
        } else if (ext === '.srt') {
            // Basic SRT validation
            return content.includes('-->') && /^\d+\s*$/m.test(content);
        }
        
        return false;
    } catch (error) {
        console.error('Error validating subtitle file:', error.message);
        return false;
    }
}

function validateOutputFormat(format) {
    const validFormats = ['srt', 'txt', 'both'];
    return validFormats.includes(format);
}

// ===== ENHANCED FILE INFO FUNCTION =====
function getFileInfo(filePath) {
    try {
        const stats = fs.statSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const baseName = path.basename(filePath, ext);
        const dir = path.dirname(filePath);
        
        let contentPreview = '';
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            contentPreview = content.substring(0, 200) + (content.length > 200 ? '...' : '');
        } catch (readError) {
            contentPreview = 'Could not read content';
        }
        
        return {
            exists: true,
            size: stats.size,
            extension: ext,
            baseName: baseName,
            directory: dir,
            isValid: isValidSubtitleFile(filePath),
            contentPreview: contentPreview,
            lastModified: stats.mtime
        };
    } catch (error) {
        return {
            exists: false,
            error: error.message
        };
    }
}

// ===== ENHANCED ERROR CLASSES =====
class SubtitleConversionError extends Error {
    constructor(message, code = null, originalError = null) {
        super(message);
        this.name = 'SubtitleConversionError';
        this.code = code;
        this.originalError = originalError;
    }
}

class FileValidationError extends SubtitleConversionError {
    constructor(message, filePath = null) {
        super(message, 'FILE_VALIDATION_ERROR');
        this.filePath = filePath;
    }
}

class ConversionError extends SubtitleConversionError {
    constructor(message, format = null) {
        super(message, 'CONVERSION_ERROR');
        this.format = format;
    }
}

// ===== ENHANCED COMMAND LINE INTERFACE =====
function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log(`
🎬 SUBTITLE CONVERTER TOOL - ENHANCED FIXED VERSION (Duplicate Issue Resolved)
===========================================================================

Cách sử dụng:
  node subtitle-converter.js <file/folder> [format]

Tham số:
  <file/folder>  : Đường dẫn đến file VTT/SRT hoặc thư mục
  [format]       : srt, txt, hoặc both (mặc định: both)

Ví dụ:
  node subtitle-converter.js video.vtt
  node subtitle-converter.js video.vtt txt
  node subtitle-converter.js ./subtitles both
  node subtitle-converter.js "C:\\\\Downloads\\\\video.vtt" srt

🔧 FIXED ISSUES IN THIS VERSION:
  ✅ FIXED: Duplicate text lines removed with smart similarity detection
  ✅ FIXED: Enhanced text cleaning with artifact removal
  ✅ FIXED: Improved VTT cue processing to prevent repetition
  ✅ FIXED: Better SRT to TXT conversion with unique line filtering
  ✅ FIXED: Added Levenshtein distance algorithm for similarity check
  ✅ FIXED: Enhanced duplicate detection with configurable threshold

Tính năng ENHANCED FIXED:
  ✅ VTT → SRT conversion với timestamp chuẩn và error handling
  ✅ VTT → TXT extraction với text sạch và validation
  ✅ SRT → TXT conversion với improved parsing
  ✅ Batch processing cho thư mục với progress tracking
  ✅ Enhanced error handling và recovery
  ✅ File validation và content verification với format checking
  ✅ Content cleaning và normalization với HTML entity support
  ✅ Cross-platform path handling
  ✅ Encoding detection và fallback support
  ✅ File size limits và security checks
  ✅ FIXED: Proper format validation và file extension verification
  ✅ FIXED: Smart duplicate removal system

Hỗ trợ:
  - Input formats: .vtt, .srt (with encoding detection)
  - Output formats: .srt, .txt (UTF-8 encoded)
  - HTML tag removal với comprehensive cleaning
  - Entity decoding với extended character set
  - Timestamp normalization với validation
  - WebVTT styling removal
  - Error recovery và graceful degradation
  - FIXED: Enhanced format validation và result verification
  - FIXED: Intelligent duplicate text removal
        `);
        return;
    }
    
    const inputPath = args[0];
    const outputFormat = args[1] || 'both';
    
    if (!validateOutputFormat(outputFormat)) {
        console.error('❌ Format không hợp lệ. Sử dụng: srt, txt, hoặc both');
        return;
    }
    
    try {
        const stats = fs.statSync(inputPath);
        
        if (stats.isFile()) {
            console.log('📄 Converting single file...');
            
            if (!isValidSubtitleFile(inputPath)) {
                console.error('❌ File không phải là subtitle hợp lệ hoặc định dạng không được hỗ trợ');
                const info = getFileInfo(inputPath);
                console.log('📋 File info:', info);
                return;
            }
            
            const results = convertSubtitleFile(inputPath, outputFormat);
            
            console.log('\n🎉 Conversion completed!');
            console.log('📋 Results:');
            results.forEach(result => {
                console.log(`  ✅ ${result.format}: ${result.path}`);
            });
            
        } else if (stats.isDirectory()) {
            console.log('📁 Converting all files in folder...');
            const results = convertAllSubtitlesInFolder(inputPath, outputFormat);
            
            console.log('\n🎉 Batch conversion completed!');
            if (results.length > 0) {
                console.log('📋 Output files:');
                results.forEach(result => {
                    console.log(`  ✅ ${result.format}: ${path.basename(result.path)}`);
                });
            } else {
                console.log('⚠️ No files were converted successfully');
            }
        }
        
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`❌ File hoặc thư mục không tồn tại: ${inputPath}`);
        } else {
            console.error(`❌ Error: ${error.message}`);
            if (process.argv.includes('--debug')) {
                console.error('Stack trace:', error.stack);
            }
        }
    }
}

// ===== ENHANCED UTILITY FUNCTIONS =====
function cleanText(text) {
    return cleanTextLine(text);
}

function normalizeTimestampUtil(timestamp) {
    return normalizeTimestamp(timestamp);
}

// ===== EXPORT FOR USE IN OTHER SCRIPTS =====
module.exports = {
    convertVttToSrt,
    convertSrtToTxt,
    convertSubtitleFile,
    convertAllSubtitlesInFolder,
    isValidSubtitleFile,
    validateOutputFormat,
    cleanText: cleanTextLine,
    normalizeTimestamp,
    getFileInfo,
    SubtitleConversionError,
    FileValidationError,
    ConversionError,
    removeSimilarLines,
    calculateSimilarity,
    levenshteinDistance
};

// Run main function if script is executed directly
if (require.main === module) {
    main();
}

console.log('📚 Subtitle Converter Module Loaded - ENHANCED FIXED VERSION (Duplicate Issue Resolved)');
console.log('🔧 Features: VTT/SRT conversion, batch processing, enhanced error handling, format validation, smart duplicate removal');