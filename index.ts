import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { exec} from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

async function getDuration(file: string): Promise<number> {
  const { stdout } = await execPromise(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`);
  return parseFloat(stdout.trim());
}

async function normalizeClip(inputPath: string, outputPath: string): Promise<void> {
  const cmd = `ffmpeg -y -i "${inputPath}" -c:v libvpx -b:v 1M -c:a libvorbis "${outputPath}"`;
  await execPromise(cmd);
}


async function concatWebmWithReencode(clipsDir: string, outputName: string) {

  // step 1 : to extract original webm files from initial-clips folder (can be audio only, video only or both video + audio) 
  const files = await fs.readdir(clipsDir);
  const webmFiles = files
    .filter(f => f.endsWith('.webm'))
    .map(f => path.join(clipsDir, f));

  if (webmFiles.length === 0) throw new Error("No .webm files found");

  // step 2 : normalizing them to same codecs  
  webmFiles.forEach(async (f,index)=>{
    const filename = path.basename(f, '.webm'); 
    const outputPath = path.join('updated-clips', `${filename}_norm.webm`);
    await normalizeClip(f,outputPath);
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const normClipsDir = path.join(__dirname, 'updated-clips');
  const normFiles = await fs.readdir(normClipsDir);
  const normWebmFiles = normFiles
    .filter(f => f.endsWith('.webm'))
    .map(f => path.join(normClipsDir, f));

  const inputsArray: string[] = [];
  const filterParts: string[] = [];
  let inputIndex = 0;

  // step 3 : concatinating the normalized webm files into a single file
  for (const file of normWebmFiles) {
    const { stdout } = await execPromise(`ffprobe -v error -show_entries stream=codec_type -of csv=p=0 "${file}"`);
    const hasVideo = stdout.includes("video");
    const hasAudio = stdout.includes("audio");

    inputsArray.push(`-i "${file}"`);
    const baseIndex = inputIndex;
    inputIndex++;

    let videoLabel = '';
    let audioLabel = '';

    if (hasVideo) {
      videoLabel = `[${baseIndex}:v:0]`;
    } else {
      const duration = await getDuration(file);
      inputsArray.push(`-f lavfi -t ${duration} -i color=size=640x480:rate=30:color=black`);
      videoLabel = `[${inputIndex}:v:0]`;
      inputIndex++;
    }

    if (hasAudio) {
      audioLabel = `[${baseIndex}:a:0]`;
    } else {
      const duration = await getDuration(file);
      inputsArray.push(`-f lavfi -t ${duration} -i anullsrc=channel_layout=mono:sample_rate=48000`);
      audioLabel = `[${inputIndex}:a:0]`;
      inputIndex++;
    }

    filterParts.push(`${videoLabel}${audioLabel}`);
  }

  const inputs = inputsArray.join(' ');

  const filter = `${filterParts.join('')}concat=n=${normWebmFiles.length}:v=1:a=1[outv][outa]`;

  const outputPath = path.join('updated-clips', outputName);

  const cmd = `ffmpeg ${inputs} -filter_complex "${filter}" -map "[outv]" -map "[outa]" -c:v libvpx -b:v 1M -c:a libvorbis "${outputPath}"`;

  console.log("Running:", cmd);
  await execPromise(cmd);
  console.log("Merged video saved to", outputPath);

}

async function run() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const clipsDir = path.join(__dirname, 'initial-clips');
  await concatWebmWithReencode(clipsDir, 'final_output.webm');
}

run().catch(console.error);
