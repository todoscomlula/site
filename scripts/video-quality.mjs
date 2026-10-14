import { spawn } from 'node:child_process';

export function runMediaCommand(binary, args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'] });
    const chunks = [];
    if (capture) child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', () => reject(new Error('Ferramenta de mídia indisponível.')));
    child.on('close', (code) => code === 0 ? resolve(Buffer.concat(chunks).toString()) : reject(new Error('Processamento de mídia falhou.')));
  });
}

/** Preserve source streams and dimensions; only convert unsupported codecs. */
export async function prepareVideoQuality(input, output, command = runMediaCommand) {
  const probe = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', input], true));
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  if (!video || !(Number(probe.format?.duration) > 0)) throw new Error('Vídeo de origem inválido.');
  const args = ['-nostdin', '-y', '-v', 'error', '-i', input, '-map', '0:v:0', '-map', '0:a:0?'];
  if (video.codec_name === 'h264') args.push('-c:v', 'copy');
  else args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p');
  args.push('-c:a', !audio || audio.codec_name === 'aac' ? 'copy' : 'aac');
  if (audio && audio.codec_name !== 'aac') args.push('-b:a', '160k');
  args.push('-map_metadata', '-1', '-movflags', '+faststart', output);
  await command('ffmpeg', args);
  return { width: video.width, height: video.height, duration: Number(probe.format.duration), copiedVideo: video.codec_name === 'h264' };
}
